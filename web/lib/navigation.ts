export function workspaceHref(path: string, siteId?: string | null): string {
  return siteId ? `${path}?${new URLSearchParams({ site: siteId })}` : path;
}

export function activeWorkspace(pathname: string, tab?: string | null): string {
  if (/^\/sites\/[^/]+\/violations(?:\/|$)/.test(pathname)) return '/violations';
  if (/^\/sites\/[^/]+$/.test(pathname)) {
    return tab === 'setup' ? '/site-setup' : tab === 'detection' ? '/detection' : '/site-view';
  }
  return pathname;
}

export function chatHref(siteId: string, violationId: string): string {
  return `/chat?${new URLSearchParams({ site: siteId, violation: violationId })}`;
}

export function loginDestination(value: string | null | undefined) {
  // Only local page destinations; refuse protocol-relative and backslash URLs.
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
  const url = new URL(value, 'http://console.local');
  if (url.origin !== 'http://console.local' || /^\/(?:login|auth|api|feed|poster|health)(?:\/|$)/.test(url.pathname)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
