import type { CategoryId } from "./types";

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** One short, jargon-free line for non-technical visitors. */
  plain: string;
  color: string;
  /** GitHub topics searched to find candidates for this galaxy. */
  searchTopics: string[];
  /** Keywords for the offline/keyword classifier (matched against topics, name, description). */
  keywords: string[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: "ai",
    label: "KI / LLM",
    plain: "Künstliche Intelligenz, Chatbots, Sprachmodelle",
    color: "#b28cff",
    searchTopics: ["llm", "ai-agents", "machine-learning", "generative-ai", "mcp"],
    keywords: [
      "llm", "ai", "gpt", "agent", "agents", "machine-learning", "deep-learning", "neural",
      "transformer", "transformers", "diffusion", "rag", "chatbot", "openai", "claude", "anthropic",
      "gemini", "llama", "mcp", "embedding", "inference", "pytorch", "tensorflow", "nlp",
      "stable-diffusion", "generative-ai", "artificial-intelligence", "ml", "model-context-protocol",
    ],
  },
  {
    id: "devtools",
    label: "DevTools",
    plain: "Werkzeuge, mit denen Entwickler schneller arbeiten",
    color: "#4fd1c5",
    searchTopics: ["developer-tools", "cli", "terminal", "editor"],
    keywords: [
      "cli", "terminal", "editor", "ide", "vscode", "neovim", "vim", "developer-tools", "devtools",
      "linter", "formatter", "git", "debugger", "compiler", "build-tool", "package-manager",
      "testing", "shell", "productivity", "code-review", "tui",
    ],
  },
  {
    id: "web",
    label: "Web",
    plain: "Websites, Web-Apps und ihre Baukästen",
    color: "#5ea8ff",
    searchTopics: ["react", "frontend", "web-framework", "nextjs"],
    keywords: [
      "react", "vue", "svelte", "angular", "nextjs", "frontend", "web", "css", "html", "javascript",
      "typescript", "web-framework", "ui", "components", "tailwindcss", "browser", "http", "api",
      "cms", "static-site-generator", "ssr", "vite", "webassembly",
    ],
  },
  {
    id: "security",
    label: "Security",
    plain: "Schutz vor Angriffen, Schwachstellen finden",
    color: "#ff6b81",
    searchTopics: ["security", "cybersecurity", "pentesting"],
    keywords: [
      "security", "cybersecurity", "pentest", "pentesting", "vulnerability", "exploit", "malware",
      "osint", "cve", "encryption", "cryptography", "password", "authentication", "privacy",
      "red-team", "blue-team", "forensics", "secrets", "sast", "firewall", "hacking",
    ],
  },
  {
    id: "data",
    label: "Data",
    plain: "Datenbanken, Analysen und Datenverarbeitung",
    color: "#ffb454",
    searchTopics: ["database", "data-engineering", "analytics"],
    keywords: [
      "database", "sql", "postgres", "postgresql", "mysql", "sqlite", "data", "analytics",
      "data-engineering", "etl", "dataframe", "data-science", "visualization", "bigdata",
      "vector-database", "olap", "pandas", "spark", "warehouse", "bi", "redis", "nosql",
    ],
  },
  {
    id: "mobile",
    label: "Mobile",
    plain: "Apps für Smartphones, Tablets und Desktop",
    color: "#7ee081",
    searchTopics: ["android", "ios", "flutter", "react-native"],
    keywords: [
      "android", "ios", "mobile", "flutter", "react-native", "swift", "kotlin", "swiftui",
      "jetpack-compose", "expo", "desktop-app", "cross-platform", "tauri", "electron",
    ],
  },
  {
    id: "infra",
    label: "Infra",
    plain: "Server, Cloud und alles, was Software am Laufen hält",
    color: "#ff8fd6",
    searchTopics: ["kubernetes", "devops", "self-hosted", "infrastructure"],
    keywords: [
      "kubernetes", "k8s", "docker", "container", "devops", "cloud", "infrastructure", "terraform",
      "serverless", "monitoring", "observability", "self-hosted", "selfhosted", "proxy", "nginx",
      "deployment", "ci", "cd", "aws", "gcp", "azure", "networking", "server", "homelab",
    ],
  },
  {
    id: "games",
    label: "Games",
    plain: "Spiele und Werkzeuge, um Spiele zu bauen",
    color: "#ffe066",
    searchTopics: ["game-engine", "game-development", "gamedev"],
    keywords: [
      "game", "games", "gamedev", "game-engine", "game-development", "unity", "godot", "minecraft",
      "emulator", "3d", "graphics", "opengl", "vulkan", "physics", "rendering", "pixel-art",
    ],
  },
  {
    id: "other",
    label: "Sonstiges",
    plain: "Alles andere: Lernmaterial, Apps, Kuriositäten",
    color: "#a9b4c9",
    searchTopics: [],
    keywords: [],
  },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryDef>;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .filter(Boolean);
}

/**
 * Keyword fallback classifier (used when no ANTHROPIC_API_KEY is configured).
 * Topics weigh more than words in name/description.
 */
export function classifyByKeywords(input: {
  name: string;
  description: string | null;
  topics: string[];
}): CategoryId {
  const topics = new Set(input.topics.map((t) => t.toLowerCase()));
  const words = new Set([
    ...tokenize(input.name.replace(/[-_]/g, " ")),
    ...tokenize(input.description ?? ""),
  ]);
  let best: CategoryId = "other";
  let bestScore = 0;
  for (const cat of CATEGORIES) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (topics.has(kw)) score += 3;
      if (words.has(kw)) score += 1;
    }
    if (score > bestScore) {
      best = cat.id;
      bestScore = score;
    }
  }
  return best;
}
