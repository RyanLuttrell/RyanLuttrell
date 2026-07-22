// Generates the "GitHub at a glance" SVG cards (stats + top languages) in dark
// and light variants. Runs in CI with the default GITHUB_TOKEN, so all numbers
// reflect public activity only.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOGIN = "RyanLuttrell";
const OUT_DIR = process.env.OUT_DIR || "dist";
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const query = `query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection {
      contributionCalendar { totalContributions }
    }
    pullRequests { totalCount }
    issues { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10) { edges { size node { name color } } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": LOGIN,
  },
  body: JSON.stringify({ query, variables: { login: LOGIN } }),
});
const { data, errors } = await res.json();
if (errors || !data?.user) {
  console.error("GraphQL error:", JSON.stringify(errors));
  process.exit(1);
}

const u = data.user;
if (u.repositories.totalCount > 100) {
  console.warn(`Only the 100 most recently pushed of ${u.repositories.totalCount} repos are counted`);
}
const stars = u.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0);
// Balanced weighting (sqrt(bytes) * sqrt(repo count)) so a few byte-heavy
// vendored codebases don't drown out languages used across many repos.
const langTotals = new Map();
for (const repo of u.repositories.nodes) {
  for (const { size, node } of repo.languages.edges) {
    const cur = langTotals.get(node.name) || { size: 0, count: 0, color: node.color };
    cur.size += size;
    cur.count += 1;
    langTotals.set(node.name, cur);
  }
}
for (const l of langTotals.values()) l.score = Math.sqrt(l.size) * Math.sqrt(l.count);
const topLangs = [...langTotals.entries()]
  .sort((a, b) => b[1].score - a[1].score)
  .slice(0, 6);
const langSum = topLangs.reduce((n, [, l]) => n + l.score, 0);

const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const THEMES = {
  dark: { title: "#818cf8", text: "#9198a1", value: "#e6edf3", border: "#30363d" },
  light: { title: "#4f46e5", text: "#57606a", value: "#1f2328", border: "#d0d7de" },
};
const SANS = `-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `'SFMono-Regular', 'Cascadia Code', Consolas, 'Liberation Mono', monospace`;

const rows = [
  ["Stars earned", fmt(stars)],
  ["Contributions (past year)", fmt(u.contributionsCollection.contributionCalendar.totalContributions)],
  ["Pull requests", fmt(u.pullRequests.totalCount)],
  ["Issues", fmt(u.issues.totalCount)],
  ["Public repos", fmt(u.repositories.totalCount)],
];

function statsCard(t) {
  const rowSvg = rows
    .map(
      ([label, value], i) => `
  <g class="row" style="animation-delay:${(i * 0.12).toFixed(2)}s">
    <text x="24" y="${88 + i * 24}" style="font:400 14px ${SANS}" fill="${t.text}">${esc(label)}</text>
    <text x="436" y="${88 + i * 24}" text-anchor="end" style="font:600 14px ${MONO}" fill="${t.value}">${value}</text>
  </g>`
    )
    .join("");
  return `<svg width="460" height="210" viewBox="0 0 460 210" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .row { opacity: 0; animation: fadein 0.6s ease-out forwards; }
    @keyframes fadein { to { opacity: 1; } }
  </style>
  <rect x="0.5" y="0.5" width="459" height="209" rx="10" stroke="${t.border}"/>
  <text x="24" y="42" style="font:600 18px ${SANS}" fill="${t.title}">GitHub stats</text>${rowSvg}
</svg>
`;
}

function langsCard(t) {
  let x = 24;
  const barW = 412;
  const segments = topLangs
    .map(([name, l]) => {
      const w = (l.score / langSum) * barW;
      const seg = `<rect x="${x.toFixed(1)}" y="60" width="${w.toFixed(1)}" height="10" fill="${l.color || "#8b949e"}"><title>${esc(name)}</title></rect>`;
      x += w;
      return seg;
    })
    .join("\n    ");
  const legend = topLangs
    .map(([name, l], i) => {
      const cx = i % 2 === 0 ? 24 : 244;
      const cy = 102 + Math.floor(i / 2) * 28;
      const pct = ((l.score / langSum) * 100).toFixed(1);
      return `
  <g class="row" style="animation-delay:${(0.5 + i * 0.1).toFixed(2)}s">
    <circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color || "#8b949e"}"/>
    <text x="${cx + 18}" y="${cy}" style="font:400 13px ${SANS}" fill="${t.value}">${esc(name)}</text>
    <text x="${cx + 18 + name.length * 7 + 10}" y="${cy}" style="font:400 12px ${MONO}" fill="${t.text}">${pct}%</text>
  </g>`;
    })
    .join("");
  return `<svg width="460" height="210" viewBox="0 0 460 210" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .bar { transform: scaleX(0); transform-origin: 24px 0; animation: grow 0.9s 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
    @keyframes grow { to { transform: scaleX(1); } }
    .row { opacity: 0; animation: fadein 0.6s ease-out forwards; }
    @keyframes fadein { to { opacity: 1; } }
  </style>
  <defs>
    <clipPath id="pill"><rect x="24" y="60" width="${barW}" height="10" rx="5"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="459" height="209" rx="10" stroke="${t.border}"/>
  <text x="24" y="42" style="font:600 18px ${SANS}" fill="${t.title}">Most used languages</text>
  <g class="bar" clip-path="url(#pill)">
    ${segments}
  </g>${legend}
</svg>
`;
}

await mkdir(OUT_DIR, { recursive: true });
for (const [theme, t] of Object.entries(THEMES)) {
  await writeFile(join(OUT_DIR, `stats-${theme}.svg`), statsCard(t));
  await writeFile(join(OUT_DIR, `langs-${theme}.svg`), langsCard(t));
}
console.log(
  `Generated cards for ${LOGIN}: ${stars} stars, ` +
    `${u.contributionsCollection.contributionCalendar.totalContributions} contributions, ` +
    `top languages: ${topLangs.map(([n]) => n).join(", ")}`
);
