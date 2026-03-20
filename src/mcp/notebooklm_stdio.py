import asyncio
import logging
import sys
import os

# NotebookLM MCP Stdio Bridge
# This script wraps the NotebookLM MCP server (which defaults to SSE) 
# and exposes it over stdio for compatibility with Golem's MCPClient.

try:
    from notebooklm.mcp_server import create_mcp_server
    from notebooklm.client import NotebookLMClient
    from mcp.server.stdio import stdio_server
except ImportError as e:
    print(f"Error: Missing dependencies. {e}", file=sys.stderr)
    sys.exit(1)

async def main():
    # Configure logging to stderr to avoid interfering with stdout JSON-RPC
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr
    )
    
    logger = logging.getLogger("notebooklm_stdio")
    logger.info("Starting NotebookLM MCP stdio bridge...")

    server, client_holder = create_mcp_server()

    # Initialize the client from storage or environment
    try:
        client = await NotebookLMClient.from_storage()
        await client.__aenter__()
        client_holder.append(client)
        logger.info("NotebookLM client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize NotebookLM client: {e}")
        sys.exit(1)

    try:
        async with stdio_server() as (read, write):
            await server.run(
                read, 
                write, 
                server.create_initialization_options(), 
                stateless=True
            )
    except Exception as e:
        logger.error(f"MCP server error: {e}")
    finally:
        await client.__aexit__(None, None, None)
        logger.info("NotebookLM MCP bridge stopped")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
