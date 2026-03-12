#!/bin/bash

# Define colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}No .env file found. Creating from .env.example...${NC}"
    cp .env.example .env
fi

case "$1" in
    start)
        echo -e "${GREEN}Starting Open Inspector stack...${NC}"
        docker-compose up -d --build
        echo -e "${BLUE}Dashboard will be available at: http://localhost:5173${NC}"
        ;;
    stop)
        echo -e "${YELLOW}Stopping Open Inspector stack...${NC}"
        docker-compose down
        ;;
    status)
        docker-compose ps
        ;;
    logs)
        if [ -z "$2" ]; then
            docker-compose logs -f
        else
            docker-compose logs -f "$2"
        fi
        ;;
    config)
        # Open .env in default editor, fallback to nano
        ${EDITOR:-nano} .env
        ;;
    dashboard)
        echo -e "${GREEN}Opening Dashboard in your browser...${NC}"
        # OS-agnostic way to open a URL
        if which xdg-open > /dev/null; then
            xdg-open http://localhost:5173
        elif which gnome-open > /dev/null; then
            gnome-open http://localhost:5173
        elif which open > /dev/null; then
            open http://localhost:5173
        else
            echo "Please navigate to http://localhost:5173 in your browser."
        fi
        ;;
    *)
        echo -e "${BLUE}Open Inspector CLI${NC}"
        echo "Usage: ./llm-obs.sh [command]"
        echo ""
        echo "Commands:"
        echo "  start       Build and start all services in the background"
        echo "  stop        Stop and tear down all services"
        echo "  status      Check the status of running containers"
        echo "  logs [svc]  View logs for all services, or specify one (proxy, ui, dashboard-api, postgres)"
        echo "  config      Edit the .env configuration file"
        echo "  dashboard   Open the web dashboard in your default browser"
        ;;
esac
