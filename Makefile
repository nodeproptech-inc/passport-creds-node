.PHONY: help up down api cre web db migrate ngrok logs \
        test-kyc test-green test-red status stop reset-db \
        build-cre env-check

# ─── Config ───────────────────────────────────────────────────────────────────

WALLET        ?= 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
API_URL       := http://localhost:3001
CRE_URL       := http://localhost:3002
API_LOG       := /tmp/passport-api.log
CRE_LOG       := /tmp/passport-cre.log
WEB_LOG       := /tmp/passport-web.log
NGROK_LOG     := /tmp/passport-ngrok.log

# ─── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  PassportCreds by Node — dev commands"
	@echo ""
	@echo "  Setup"
	@echo "    make env-check     — verify .env files exist"
	@echo "    make db            — start PostgreSQL (podman)"
	@echo "    make migrate       — run Prisma migrations"
	@echo "    make build-cre     — build CRE TypeScript"
	@echo ""
	@echo "  Start services"
	@echo "    make api           — start NestJS API on :3001"
	@echo "    make cre           — start CRE server on :3002"
	@echo "    make web           — start Next.js frontend on :3000"
	@echo "    make ngrok         — expose :3001 via ngrok (set NGROK_URL after)"
	@echo "    make up            — start db + api + cre + web (background)"
	@echo ""
	@echo "  Test flows (WALLET=0x... make test-kyc)"
	@echo "    make test-kyc      — KYC approved → passport = LIMITED"
	@echo "    make test-green    — KYC + Accreditation → passport = GREEN"
	@echo "    make test-red      — KYC failed → passport = RED"
	@echo "    make status        — show current passport state"
	@echo ""
	@echo "  Logs"
	@echo "    make logs          — tail all service logs"
	@echo ""
	@echo "  Stop / reset"
	@echo "    make stop          — kill API, CRE, frontend, ngrok"
	@echo "    make down          — stop and remove postgres container"
	@echo "    make reset-db      — wipe DB + re-migrate (DESTROYS DATA)"
	@echo ""

# ─── Setup ────────────────────────────────────────────────────────────────────

env-check:
	@test -f apps/api/.env   || (echo "ERROR: apps/api/.env missing — copy from apps/api/.env.example" && exit 1)
	@test -f cre/.env        || (echo "ERROR: cre/.env missing — copy from cre/.env.example" && exit 1)
	@test -f apps/web/.env.local || (echo "WARNING: apps/web/.env.local missing — copy from apps/web/.env.example"; true)
	@echo "✓ .env files OK"

db:
	@echo "→ Starting PostgreSQL..."
	@podman compose up -d postgres
	@echo "✓ PostgreSQL up on :5433"

migrate:
	@echo "→ Running Prisma migrations..."
	@cd apps/api && npx prisma migrate deploy
	@echo "✓ Migrations done"

build-cre:
	@echo "→ Building CRE..."
	@npm run build --workspace=cre
	@echo "✓ CRE built"

# ─── Start services (background) ──────────────────────────────────────────────

api:
	@echo "→ Starting NestJS API on :3001 (log: $(API_LOG))"
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	@cd apps/api && npx ts-node --transpile-only src/main.ts > $(API_LOG) 2>&1 &
	@sleep 3
	@curl -sf $(API_URL)/passport/$(WALLET) > /dev/null && echo "✓ API up" || echo "✗ API failed to start — check $(API_LOG)"

cre:
	@echo "→ Starting CRE server on :3002 (log: $(CRE_LOG))"
	@lsof -ti:3002 | xargs kill -9 2>/dev/null || true
	@cd cre && node dist/server.js > $(CRE_LOG) 2>&1 &
	@sleep 2
	@curl -sf $(CRE_URL)/health > /dev/null && echo "✓ CRE up" || echo "✗ CRE failed to start — check $(CRE_LOG)"

web:
	@echo "→ Starting Next.js on :3000 (log: $(WEB_LOG))"
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@cd apps/web && npm run dev > $(WEB_LOG) 2>&1 &
	@sleep 5
	@curl -sf http://localhost:3000 > /dev/null && echo "✓ Frontend up" || echo "✗ Frontend not yet ready — check $(WEB_LOG)"

ngrok:
	@echo "→ Starting ngrok tunnel for :3001"
	@pkill -f "ngrok http" 2>/dev/null || true
	@ngrok http 3001 --log stdout > $(NGROK_LOG) 2>&1 &
	@sleep 3
	@NGROK_URL=$$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(next((x['public_url'] for x in t if x['public_url'].startswith('https')), 'not ready'))"); \
	 echo "✓ ngrok tunnel: $$NGROK_URL"; \
	 echo ""; \
	 echo "  Set this in apps/api/.env:"; \
	 echo "    NGROK_URL=$$NGROK_URL"; \
	 echo ""; \
	 echo "  AI Attester webhook URL:"; \
	 echo "    $$NGROK_URL/webhooks/ai-attester"

# ─── Start everything ─────────────────────────────────────────────────────────

up: build-cre
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  PassportCreds by Node — starting up"
	@echo "══════════════════════════════════════════"
	@echo ""
	@$(MAKE) db
	@sleep 2
	@$(MAKE) api
	@$(MAKE) cre
	@$(MAKE) web
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  All services started"
	@echo "  API:      http://localhost:3001"
	@echo "  CRE:      http://localhost:3002"
	@echo "  Frontend: http://localhost:3000"
	@echo ""
	@echo "  Run: make ngrok   to expose webhook"
	@echo "  Run: make logs    to tail all logs"
	@echo "══════════════════════════════════════════"
	@echo ""

# ─── Test flows ───────────────────────────────────────────────────────────────

test-kyc:
	@echo ""
	@echo "── Test: KYC/AML approved → passport = LIMITED ──"
	@VID=$$(curl -sf -X POST $(API_URL)/verification/start \
	  -H "Content-Type: application/json" \
	  -d '{"walletAddress":"$(WALLET)","claimType":"KYC_AML_VERIFIED"}' \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['verificationId'])"); \
	echo "  verificationId: $$VID"; \
	curl -sf -X POST "$(API_URL)/verification/$$VID/mock-ai-result" \
	  -H "Content-Type: application/json" -d '{"approved":true}' > /dev/null; \
	echo "  AI result injected. Waiting for CRE..."; \
	sleep 4; \
	STATUS=$$(curl -sf $(API_URL)/passport/$(WALLET) \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"); \
	echo "  passport status: $$STATUS"; \
	[ "$$STATUS" = "LIMITED" ] && echo "  ✓ PASS" || echo "  ✗ FAIL — expected LIMITED"

test-green: test-kyc
	@echo ""
	@echo "── Test: Accredited Investor → passport = GREEN ──"
	@VID=$$(curl -sf -X POST $(API_URL)/verification/start \
	  -H "Content-Type: application/json" \
	  -d '{"walletAddress":"$(WALLET)","claimType":"ACCREDITED_INVESTOR"}' \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['verificationId'])"); \
	echo "  verificationId: $$VID"; \
	curl -sf -X POST "$(API_URL)/verification/$$VID/mock-ai-result" \
	  -H "Content-Type: application/json" -d '{"approved":true}' > /dev/null; \
	echo "  AI result injected. Waiting for CRE..."; \
	sleep 4; \
	STATUS=$$(curl -sf $(API_URL)/passport/$(WALLET) \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"); \
	echo "  passport status: $$STATUS"; \
	[ "$$STATUS" = "GREEN" ] && echo "  ✓ PASS" || echo "  ✗ FAIL — expected GREEN"

test-red:
	@echo ""
	@echo "── Test: KYC failed → passport = RED ──"
	@WALLET2=0x70997970C51812dc3A010C7d01b50e0d17dc79C8; \
	VID=$$(curl -sf -X POST $(API_URL)/verification/start \
	  -H "Content-Type: application/json" \
	  -d "{\"walletAddress\":\"$$WALLET2\",\"claimType\":\"KYC_AML_VERIFIED\"}" \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['verificationId'])"); \
	echo "  verificationId: $$VID"; \
	curl -sf -X POST "$(API_URL)/verification/$$VID/mock-ai-result" \
	  -H "Content-Type: application/json" -d '{"approved":false}' > /dev/null; \
	echo "  AI result injected (failed). Waiting for CRE..."; \
	sleep 4; \
	STATUS=$$(curl -sf $(API_URL)/passport/$$WALLET2 \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"); \
	echo "  passport status: $$STATUS"; \
	[ "$$STATUS" = "RED" ] && echo "  ✓ PASS" || echo "  ✗ FAIL — expected RED"

status:
	@echo ""
	@echo "── Passport state for $(WALLET) ──"
	@curl -sf $(API_URL)/passport/$(WALLET) | python3 -c "\
import sys, json; \
d = json.load(sys.stdin); \
print(f\"  status:          {d['status']}\"); \
print(f\"  canAccessDealRoom: {d['canAccessDealRoom']}\"); \
print(f\"  canInvest:        {d['canInvest']}\"); \
[print(f\"  claim: {c['claimType']} = {c['status']}\") for c in d.get('claims', [])]; \
[print(f\"  tx:    {t['contractName']} — {t['transactionHash'][:20]}...\") for t in d.get('transactions', [])]"
	@echo ""

# ─── Logs ─────────────────────────────────────────────────────────────────────

logs:
	@echo "Tailing API, CRE, and Web logs (Ctrl+C to stop)..."
	@tail -f $(API_LOG) $(CRE_LOG) $(WEB_LOG) 2>/dev/null || echo "No log files found yet — start services first"

# ─── Stop / reset ─────────────────────────────────────────────────────────────

stop:
	@echo "→ Stopping all services..."
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3002 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@pkill -f "ngrok http" 2>/dev/null || true
	@echo "✓ All services stopped"

down: stop
	@echo "→ Stopping PostgreSQL..."
	@podman compose down
	@echo "✓ PostgreSQL stopped"

reset-db:
	@echo "WARNING: This will wipe all data in the database."
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	@$(MAKE) down
	@$(MAKE) db
	@sleep 3
	@$(MAKE) migrate
	@echo "✓ Database reset"
