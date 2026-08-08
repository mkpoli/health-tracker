// RFC 9728 derives the metadata URL from the resource path, so a client that
// never reads the WWW-Authenticate header looks here for a resource at /mcp.
export { GET } from '../+server';
