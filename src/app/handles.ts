// The browser's link to the last recording opened, so a reload opens it again
// without the user finding it on disk. Chromium alone gives such links; other
// browsers ask for the file again.

type Permission = 'granted' | 'denied' | 'prompt';
type Handle = FileSystemFileHandle & {
  queryPermission?(o: { mode: 'read' }): Promise<Permission>;
  requestPermission?(o: { mode: 'read' }): Promise<Permission>;
};
type Picker = (o: { id?: string; multiple?: boolean }) => Promise<Handle[]>;

const DB = 'fstedit';
const STORE = 'handles';

function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result.transaction(STORE, mode).objectStore(STORE));
    req.onerror = () => reject(req.error);
  });
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Keeps the link to the recording just opened; one is kept, the last. */
export async function remember(handle: FileSystemFileHandle | null): Promise<void> {
  try {
    const s = await store('readwrite');
    if (handle) await done(s.put(handle, 'last'));
    else await done(s.delete('last'));
  } catch {
    // without storage the next visit asks for the file, as before
  }
}

/** The link to the last recording opened, or null. */
export async function recall(): Promise<Handle | null> {
  try {
    return ((await done((await store('readonly')).get('last'))) as Handle | undefined) ?? null;
  } catch {
    return null;
  }
}

/** The file behind a link, when the browser still lets this page read it; `ask` may show the browser's question, and needs a click. */
export async function read(handle: Handle, ask: boolean): Promise<File | null> {
  try {
    let p = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (p === 'prompt' && ask) p = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
    return p === 'granted' ? await handle.getFile() : null;
  } catch {
    // the file was moved or deleted
    return null;
  }
}

/** The browser's own file picker with the link it gives, or null where the browser has none. */
export function picker(): Picker | null {
  const w = window as unknown as { showOpenFilePicker?: Picker };
  return w.showOpenFilePicker ? w.showOpenFilePicker.bind(window) : null;
}
