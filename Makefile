.PHONY: build up down logs validate pipeline check clean help

# ========== Build & Deployment ==========

build:
	@echo "🔨 Validating schema..."
	node content/schema/validate.mjs
	@echo "✓ Schema validated"
	@echo ""
	@echo "🏗 Building static site..."
	node web/build.js
	@echo "✓ Build complete"

up: build
	@echo ""
	@echo "🐳 Starting Docker Compose..."
	docker compose up -d --build
	@echo ""
	@echo "✓ Services started:"
	@echo "  - Caddy (web): http://localhost:8080"
	@echo "  - Proxy (API): localhost:8787 (internal)"
	@echo ""
	@echo "💡 Access via Tailscale: http://<tailscale-hostname>:8080"
	@echo "💡 ดู log ต่อ: make logs"

down:
	@echo "🛑 Stopping Docker Compose..."
	docker compose down
	@echo "✓ Services stopped"

logs:
	docker compose logs -f

logs-proxy:
	docker compose logs -f proxy

logs-web:
	docker compose logs -f web

# ========== Validation ==========

validate:
	@echo "🔍 Validating all content..."
	node content/schema/validate.mjs
	@echo ""
	@echo "🔍 Checking for API keys leaked into web/public + content..."
	@if grep -rnE 'sk-ant-[A-Za-z0-9_-]{8,}' web/public content/books content/schema content/index.json content/index.example.json 2>/dev/null; then \
		echo "❌ SECURITY: Found API key in served content!"; exit 1; \
	else \
		echo "✓ No API keys found"; \
	fi
	@echo ""
	@echo "🔍 Checking for committed PDFs..."
	@if git ls-files | grep -i '\.pdf$$'; then \
		echo "❌ VIOLATION: PDF committed to git!"; exit 1; \
	else \
		echo "✓ No PDFs in git history"; \
	fi

check: validate
	@echo ""
	@echo "🔍 Checking health endpoint (ต้องรัน 'make up' ให้ services พร้อมก่อน)..."
	@if curl -sf http://localhost:8080/api/health > /dev/null 2>&1; then \
		echo "✓ Health check passed"; \
		curl -s http://localhost:8080/api/health; echo ""; \
	else \
		echo "❌ Health endpoint ไม่ตอบสนอง — รัน 'make up' ก่อนแล้วลองใหม่"; exit 1; \
	fi
	@echo ""
	@echo "✅ All checks passed!"

# ========== Pipeline: Content Processing ==========

# Usage: make pipeline STEP=extract|clean|split|author|terms BOOK=trilaksana-quantum [CH=ch03]

pipeline:
	@if [ -z "$(STEP)" ]; then \
		echo "Usage: make pipeline STEP=extract|clean|split|author|terms BOOK=<slug> [CH=<ch01>]"; \
		exit 1; \
	fi
	@if [ -z "$(BOOK)" ]; then \
		echo "Usage: make pipeline STEP=extract|clean|split|author|terms BOOK=<slug>"; \
		exit 1; \
	fi
	@echo "🔄 Running pipeline step: $(STEP) for $(BOOK)"
	@if [ "$(STEP)" = "author" ] && [ -z "$(CH)" ]; then \
		echo "Error: author step requires CH parameter"; \
		echo "Usage: make pipeline STEP=author BOOK=trilaksana-quantum CH=ch03"; \
		exit 1; \
	fi
	@if [ "$(STEP)" = "extract" ]; then \
		python3 -m pipeline.extract --book $(BOOK); \
	elif [ "$(STEP)" = "clean" ]; then \
		python3 -m pipeline.clean --book $(BOOK); \
	elif [ "$(STEP)" = "split" ]; then \
		python3 -m pipeline.split --book $(BOOK); \
	elif [ "$(STEP)" = "author" ]; then \
		python3 -m pipeline.author --book $(BOOK) --chapter $(CH); \
	elif [ "$(STEP)" = "terms" ]; then \
		python3 -m pipeline.terms --book $(BOOK); \
	else \
		echo "Unknown step: $(STEP)"; \
		exit 1; \
	fi

# ========== Development ==========

shell-proxy:
	docker compose exec proxy sh

shell-web:
	docker compose exec web sh

# ========== Cleanup ==========

clean:
	@echo "🧹 Cleaning build outputs..."
	@find web/public -depth -mindepth 1 ! -name '.gitkeep' -delete 2>/dev/null || true
	rm -f content/index.json
	@echo "✓ Cleaned"

clean-hard: clean
	@echo "🧹 Cleaning Docker volumes..."
	docker compose down -v
	@echo "✓ Docker cleaned"

# ========== Help ==========

help:
	@echo "ไตรลักษณ์ในควอนตัม — Development Commands"
	@echo ""
	@echo "Build & Deploy:"
	@echo "  make build              Build static site (validate + generate)"
	@echo "  make up                 Build + start Docker Compose"
	@echo "  make down               Stop Docker Compose"
	@echo "  make logs               Show all logs"
	@echo "  make logs-proxy         Show proxy logs only"
	@echo "  make logs-web           Show web server logs only"
	@echo ""
	@echo "Validation:"
	@echo "  make validate           Validate all JSON + security checks"
	@echo "  make check              Full validation suite"
	@echo ""
	@echo "Pipeline (content processing):"
	@echo "  make pipeline STEP=extract BOOK=trilaksana-quantum"
	@echo "  make pipeline STEP=clean BOOK=trilaksana-quantum"
	@echo "  make pipeline STEP=split BOOK=trilaksana-quantum"
	@echo "  make pipeline STEP=author BOOK=trilaksana-quantum CH=ch03"
	@echo "  make pipeline STEP=terms BOOK=trilaksana-quantum"
	@echo ""
	@echo "Development:"
	@echo "  make shell-proxy        Open shell in proxy container"
	@echo "  make shell-web          Open shell in web container"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean              Remove build outputs"
	@echo "  make clean-hard         Remove build + Docker volumes"
	@echo ""

.DEFAULT_GOAL := help
