.PHONY: setup lint test bench audit ci

setup:
	npm ci

# Strict TypeScript type check (no emit).
lint:
	npm run lint

# Unit tests plus fast-check convergence properties (1,000 random schedules each).
test:
	npm test

bench:
	@echo "M3: memory, update size and apply time against Yjs and Automerge on a real editing trace"

# Known vulnerabilities in npm dependencies (high and critical fail).
audit:
	npm audit --audit-level=high

ci: setup lint test
