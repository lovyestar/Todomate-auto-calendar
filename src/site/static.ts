export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#1d1b17"/>
<rect x="12" y="14" width="40" height="38" fill="none" stroke="#f4efe4" stroke-width="4"/>
<path d="M12 25h40" stroke="#f4efe4" stroke-width="4"/>
<path d="M22 38l7 7 13-13" fill="none" stroke="#d27a52" stroke-width="5" stroke-linecap="square"/>
</svg>`;

export const ROBOTS_TXT = `User-agent: *
Allow: /$
Disallow: /feed/
Disallow: /api/
`;

export const MANIFEST = JSON.stringify({
  name: "투두메이트 캘린더",
  short_name: "투두메이트 캘린더",
  start_url: "/",
  display: "standalone",
  background_color: "#faf8f3",
  theme_color: "#faf8f3",
  icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
});
