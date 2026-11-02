// Hand-picked MCP servers for the marketplace. Package names and settings were checked against each project's README.
// inputs: values the install dialog asks for, put into the server's env (stdio) or headers (HTTP).
export default [
  {
    id: 'huggingface', name: 'Hugging Face', category: 'AI & ML', icon: '🤗', featured: true,
    description: 'Search models, datasets, Spaces and papers on the Hugging Face Hub, and read their docs. A token unlocks your own Spaces as tools.',
    config: { url: 'https://huggingface.co/mcp' }, url: 'https://huggingface.co/mcp',
    inputs: [{ header: 'Authorization', label: 'Hugging Face token (optional)', prefix: 'Bearer ', optional: true, secret: true }],
  },
  {
    id: 'github', name: 'GitHub', category: 'Developer tools', icon: '🐙', featured: true,
    description: "GitHub's official server: issues, pull requests, code search, Actions runs and releases, over HTTPS.",
    config: { url: 'https://api.githubcopilot.com/mcp/' }, url: 'https://github.com/github/github-mcp-server',
    inputs: [{ header: 'Authorization', label: 'GitHub personal access token', prefix: 'Bearer ', secret: true }],
  },
  {
    id: 'playwright', name: 'Playwright', category: 'Browser', icon: '🎭', featured: true,
    description: 'Drive a real browser: open pages, click, type, fill forms, read the accessibility tree and take screenshots. Great for testing web apps end to end.',
    config: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] }, url: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'chrome-devtools', name: 'Chrome DevTools', category: 'Browser', icon: '🛠️',
    description: 'Let the agent inspect a live Chrome: console messages, network requests, performance traces and the DOM. For debugging frontends.',
    config: { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }, url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
  },
  {
    id: 'context7', name: 'Context7', category: 'Docs', icon: '📚', featured: true,
    description: 'Current documentation and code examples for thousands of libraries, by name and version, so the agent stops guessing at APIs that changed.',
    config: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] }, url: 'https://github.com/upstash/context7',
  },
  {
    id: 'memory', name: 'Memory', category: 'Productivity', icon: '🧠',
    description: 'A local knowledge graph the agent can write to and read from, so facts about you and your projects carry across chats.',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }, url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking', name: 'Sequential Thinking', category: 'Productivity', icon: '🪜',
    description: 'A scratchpad for step-by-step reasoning that can branch and revise, for problems that need planning before acting.',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] }, url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'brave-search', name: 'Brave Search', category: 'Search', icon: '🦁',
    description: 'Web, news, image and local search through the Brave Search API. Needs a free API key.',
    config: { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] }, url: 'https://github.com/brave/brave-search-mcp-server',
    inputs: [{ env: 'BRAVE_API_KEY', label: 'Brave Search API key', secret: true }],
  },
  {
    id: 'firecrawl', name: 'Firecrawl', category: 'Search', icon: '🔥',
    description: 'Scrape, crawl and search the web into clean markdown, including JavaScript-heavy pages. Needs an API key.',
    config: { command: 'npx', args: ['-y', 'firecrawl-mcp'] }, url: 'https://github.com/firecrawl/firecrawl-mcp-server',
    inputs: [{ env: 'FIRECRAWL_API_KEY', label: 'Firecrawl API key', secret: true }],
  },
  {
    id: 'notion', name: 'Notion', category: 'Productivity', icon: '📝',
    description: "Search, read and edit your Notion pages and databases through Notion's official server. Needs an integration token.",
    config: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] }, url: 'https://github.com/makenotion/notion-mcp-server',
    inputs: [{ env: 'NOTION_TOKEN', label: 'Notion integration token', secret: true }],
  },
];
