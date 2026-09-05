// /editor 深連結 — ?editor=<pk> 或 /teacher/editor?id=<pk> 開啟關卡編輯器。
export function parseEditorRoute(): number | null {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('editor') ?? params.get('id');
  if (fromQuery) {
    const pk = Number(fromQuery);
    if (Number.isFinite(pk) && pk > 0) return pk;
  }
  if (/\/editor\/?$/.test(location.pathname)) {
    const id = params.get('id');
    if (id) {
      const pk = Number(id);
      if (Number.isFinite(pk) && pk > 0) return pk;
    }
  }
  return null;
}

export function clearEditorRoute(): void {
  const url = new URL(location.href);
  url.searchParams.delete('editor');
  if (/\/editor\/?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/editor\/?$/, '') || '/teacher';
  }
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
