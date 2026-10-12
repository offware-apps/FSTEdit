import type { PluginKinds } from './types';

type Kind = keyof PluginKinds;

const plugins: { [K in Kind]: PluginKinds[K][] } = {
  media: [],
  transcriber: [],
  silence: [],
  exporter: [],
  transcript: [],
};

/** Adds a plugin, or replaces the one already registered under its id. */
export function register<K extends Kind>(kind: K, plugin: PluginKinds[K]): void {
  const list = plugins[kind] as PluginKinds[K][];
  const at = list.findIndex((p) => p.id === plugin.id);
  if (at >= 0) list[at] = plugin;
  else list.push(plugin);
}

/** Removes a plugin, so a build or a test can swap one out. */
export function unregister(kind: Kind, id: string): void {
  const list = plugins[kind] as { id: string }[];
  const at = list.findIndex((p) => p.id === id);
  if (at >= 0) list.splice(at, 1);
}

/** Every plugin of one kind, in registration order. */
export function list<K extends Kind>(kind: K): readonly PluginKinds[K][] {
  return plugins[kind] as PluginKinds[K][];
}

/** The plugin with this id, or the first of its kind when the id is unknown. */
export function pick<K extends Kind>(kind: K, id?: string | null): PluginKinds[K] {
  const all = list(kind);
  const found = all.find((p) => p.id === id) ?? all[0];
  if (!found) throw new Error(`no ${kind} plugin is registered`);
  return found;
}
