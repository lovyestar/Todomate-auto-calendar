export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect x="6" y="10" width="52" height="48" rx="12" fill="#1f9d6b"/>
<rect x="6" y="10" width="52" height="14" rx="7" fill="#178257"/>
<rect x="18" y="4" width="6" height="12" rx="3" fill="#0f5c3d"/>
<rect x="40" y="4" width="6" height="12" rx="3" fill="#0f5c3d"/>
<path d="M21 40l7 7 15-15" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const ROBOTS_TXT = `User-agent: *
Allow: /$
Disallow: /feed/
Disallow: /api/
`;

export const MANIFEST = JSON.stringify({
  name: "투두메이트 캘린더",
  short_name: "투두캘린더",
  start_url: "/",
  display: "standalone",
  background_color: "#f7f8f6",
  theme_color: "#1f9d6b",
  icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
});
