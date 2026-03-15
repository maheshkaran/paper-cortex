declare module "@modelcontextprotocol/sdk/client/index.js" {
	// Minimal shim for @google/genai type dependency.
	// paper-cortex does not use MCP directly, but pi-ai depends on @google/genai.
	export type Client = Record<string, unknown>;
}
