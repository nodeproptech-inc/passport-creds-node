.PHONY: help up up-testnet down api cre web db migrate ngrok logs \
        test-kyc test-green test-red status stop reset-db \
        build-cre env-check deploy-testnet deploy-local anvil

# ─── Config ───────────────────────────────────────────────────────────────────

WALLET        ?= 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
API_URL       := http://localhost:3001
CRE_URL       := http://localhost:3002
API_LOG       := /tmp/passport-api.log
CRE_LOG       := /tmp/passport-cre.log
WEB_LOG       := /tmp/passport-web.log
NGROK_LOG     := /tmp/passport-ngrok.log
ANVIL_LOG     := /tmp/passport-anvil.log

# ─── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  PassportCreds by Node — dev commands"
	@echo ""
	@echo "  Setup"
	@echo "    make env-check     — verify .env files exist"
	@echo "    make db            — start PostgreSQL (podman)"
	@echo "    make anvil         — start local EVM node on :8545"
	@echo "    make deploy-local  — deploy contracts to local Anvil"
	@echo "    make migrate       — run Prisma migrations"
	@echo "    make build-cre     — build CRE TypeScript"
	@echo ""
	@echo "  Start services"
	@echo "    make api           — start NestJS API on :3001"
	@echo "    make cre           — start CRE server on :3002"
	@echo "    make web           — start Next.js frontend on :3000"
	@echo "    make ngrok         — expose :3001 via ngrok (set NGROK_URL after)"
	@echo "    make up            — start db + anvil + api + cre + web (local)"
	@echo "    make up-testnet    — start db + api + cre + web (Base Sepolia)"
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
	@echo "  Testnet"
	@echo "    make deploy-testnet — deploy contracts to Base Sepolia"
	@echo ""

# ─── Setup ────────────────────────────────────────────────────────────────────

env-check:
	@test -f apps/api/.env   || (echo "ERROR: apps/api/.env missing — copy from apps/api/.env.example" && exit 1)
	@test -f cre/.env        || (echo "ERROR: cre/.env missing — copy from cre/.env.example" && exit 1)
	@test -f apps/web/.env.local || (echo "WARNING: apps/web/.env.local missing — copy from apps/web/.env.example"; true)
	@echo "✓ .env files OK"

anvil:
	@echo "→ Starting Anvil (local EVM node) on :8545 (log: $(ANVIL_LOG))"
	@pkill -f "anvil" 2>/dev/null || true
	@anvil > $(ANVIL_LOG) 2>&1 &
	@sleep 2
	@curl -sf -X POST http://localhost:8545 \
	  -H "Content-Type: application/json" \
	  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null \
	  && echo "✓ Anvil up on :8545" || echo "✗ Anvil failed — check $(ANVIL_LOG)"

db:
	@echo "→ Starting PostgreSQL..."
	@podman compose up -d postgres
	@echo "✓ PostgreSQL up on :5433"

migrate:
	@echo "→ Running Prisma migrations..."
	@DB_URL=$$(grep '^DATABASE_URL' apps/api/.env | cut -d= -f2- | tr -d '"'); \
	 cd apps/api && DATABASE_URL="$$DB_URL" npx prisma migrate deploy
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
	@cd cre && env $$(grep -v '^#' .env | grep '=' | xargs) node dist/server.js > $(CRE_LOG) 2>&1 &
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
	@echo "  PassportCreds by Node — starting up (local)"
	@echo "══════════════════════════════════════════"
	@echo ""
	@$(MAKE) db
	@sleep 2
	@$(MAKE) anvil
	@sleep 2
	@$(MAKE) deploy-local
	@$(MAKE) api
	@$(MAKE) cre
	@$(MAKE) web
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  All services started"
	@echo "  Anvil:    http://localhost:8545"
	@echo "  API:      http://localhost:3001"
	@echo "  CRE:      http://localhost:3002"
	@echo "  Frontend: http://localhost:3000"
	@echo ""
	@echo "  Run: make ngrok   to expose webhook"
	@echo "  Run: make logs    to tail all logs"
	@echo "══════════════════════════════════════════"
	@echo ""

up-testnet: build-cre
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  PassportCreds by Node — starting up (Base Sepolia)"
	@echo "══════════════════════════════════════════"
	@echo ""
	@$(MAKE) db
	@sleep 2
	@$(MAKE) api
	@$(MAKE) cre
	@$(MAKE) web
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  All services started (testnet mode)"
	@echo "  Network:  Base Sepolia (chain 84532)"
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
	@echo "Tailing Anvil, API, CRE, and Web logs (Ctrl+C to stop)..."
	@tail -f $(ANVIL_LOG) $(API_LOG) $(CRE_LOG) $(WEB_LOG) 2>/dev/null || echo "No log files found yet — start services first"

# ─── Stop / reset ─────────────────────────────────────────────────────────────

deploy-local:
	@echo "→ Deploying contracts to local Anvil..."
	@cd contracts && \
	  DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
	  CRE_UPDATER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
	  forge script script/DeployPassportCreds.s.sol \
	    --rpc-url http://localhost:8545 \
	    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
	    --broadcast \
	  > /tmp/passport-deploy-local.log 2>&1 \
	  && echo "✓ Contracts deployed locally" \
	  || (echo "✗ Deploy failed — check /tmp/passport-deploy-local.log" && cat /tmp/passport-deploy-local.log)

stop:
	@echo "→ Stopping all services..."
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3002 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@pkill -f "ngrok http" 2>/dev/null || true
	@pkill -f "anvil" 2>/dev/null || true
	@echo "✓ All services stopped"

down: stop
	@echo "→ Stopping PostgreSQL..."
	@podman compose down
	@echo "✓ PostgreSQL stopped"

reset-db:
	@echo "WARNING: This will wipe all data in the database (including volumes)."
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	@$(MAKE) stop
	@podman compose down -v
	@$(MAKE) db
	@sleep 3
	@$(MAKE) migrate
	@echo "✓ Database reset"

# ─── Testnet deploy ───────────────────────────────────────────────────────────

deploy-testnet:
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  PassportCreds — Testnet Deploy"
	@echo "══════════════════════════════════════════"
	@test -f contracts/.env || (echo "ERROR: contracts/.env missing — fill in DEPLOYER_PRIVATE_KEY, CRE_UPDATER_ADDRESS, RPC_URL" && exit 1)
	@source contracts/.env && \
	  [ -n "$$DEPLOYER_PRIVATE_KEY" ] && [ "$$DEPLOYER_PRIVATE_KEY" != "0x" ] || \
	  (echo "ERROR: DEPLOYER_PRIVATE_KEY not set in contracts/.env" && exit 1)
	@echo "→ Building contracts..."
	@cd contracts && forge build
	@echo "→ Deploying to testnet..."
	@cd contracts && source .env && forge script script/DeployPassportCreds.s.sol \
	  --rpc-url $$RPC_URL \
	  --private-key $$DEPLOYER_PRIVATE_KEY \
	  --broadcast 2>&1 | tee /tmp/passport-deploy.log
	@echo ""
	@echo "✓ Deploy done. Check /tmp/passport-deploy.log for addresses."
	@echo "  Copy the three contract addresses to:"
	@echo "    contracts/deployments.json (testnet section)"
	@echo "    apps/api/.env"
	@echo "    cre/.env"
	@echo "    apps/web/.env.local"
	@echo ""
