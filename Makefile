.PHONY: help build up down logs restart clean setup-indices health

# Default target
help:
	@echo "CyberSentinel SOAR - Docker Management"
	@echo ""
	@echo "Available commands:"
	@echo "  make build          - Build all Docker images"
	@echo "  make up             - Start all services"
	@echo "  make down           - Stop all services"
	@echo "  make restart        - Restart all services"
	@echo "  make logs           - View logs (all services)"
	@echo "  make logs-backend   - View backend logs"
	@echo "  make logs-frontend  - View frontend logs"
	@echo "  make logs-opensearch - View OpenSearch logs"
	@echo "  make setup-indices  - Initialize OpenSearch indices"
	@echo "  make health         - Check health of all services"
	@echo "  make clean          - Remove containers and volumes (DELETES DATA)"
	@echo "  make shell-backend  - Access backend container shell"
	@echo "  make shell-frontend - Access frontend container shell"
	@echo ""

# Build images
build:
	@echo "Building Docker images..."
	docker-compose build

# Start services
up:
	@echo "Starting CyberSentinel SOAR..."
	docker-compose up -d
	@echo ""
	@echo "Services started! Waiting for health checks..."
	@sleep 10
	@make health

# Stop services
down:
	@echo "Stopping services..."
	docker-compose down

# View logs
logs:
	docker-compose logs -f

logs-backend:
	docker-compose logs -f backend

logs-frontend:
	docker-compose logs -f frontend

logs-opensearch:
	docker-compose logs -f opensearch

# Restart services
restart:
	@echo "Restarting services..."
	docker-compose restart

# Setup OpenSearch indices
setup-indices:
	@echo "Setting up OpenSearch indices..."
	@echo "Waiting for OpenSearch to be ready..."
	@sleep 20
	docker-compose exec backend npm run setup-indices

# Health checks
health:
	@echo "Checking service health..."
	@echo ""
	@echo "Frontend:"
	@curl -s -o /dev/null -w "  Status: %{http_code}\n" http://localhost/ || echo "  Status: DOWN"
	@echo ""
	@echo "Backend:"
	@curl -s http://localhost:3001/health | python3 -m json.tool || echo "  Status: DOWN"
	@echo ""
	@echo "OpenSearch:"
	@curl -s -k -u admin:CyberSentinel@2024 https://localhost:9200/_cluster/health | python3 -m json.tool || echo "  Status: DOWN"
	@echo ""

# Clean up (WARNING: Deletes all data!)
clean:
	@echo "WARNING: This will delete all containers, volumes, and data!"
	@read -p "Are you sure? (yes/no): " confirm && [ "$$confirm" = "yes" ]
	docker-compose down -v
	@echo "Cleanup complete!"

# Shell access
shell-backend:
	docker-compose exec backend sh

shell-frontend:
	docker-compose exec frontend sh

shell-opensearch:
	docker-compose exec opensearch bash

# Full deployment (build, start, setup)
deploy: build up
	@echo "Waiting for services to stabilize..."
	@sleep 30
	@make setup-indices
	@echo ""
	@echo "✅ CyberSentinel SOAR deployment complete!"
	@echo ""
	@echo "Access the application at:"
	@echo "  Frontend:  http://localhost"
	@echo "  Backend:   http://localhost:3001"
	@echo "  OpenSearch Dashboards: http://localhost:5601"
	@echo ""
