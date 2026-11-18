// Keeps ImageSetConfiguration fields that the form editor does not model.
//
// The form only edits a subset of the ImageSetConfiguration schema. When a user loads a
// file or edits the YAML preview, fields outside that subset (helm, blockedImages,
// platform.architectures, operator targetCatalog/targetTag/full, operator channel
// maxVersion, ...) must survive a save instead of being silently dropped.
//
// Rules:
// - Values produced by the form always win for the fields the form owns.
// - Extra fields are copied onto items that still exist in the form, matched by identity
//   (catalog URL, package name, channel name, image name). Items the user removed in the
//   form are not brought back.
// - Whole sections the form does not model are kept as they are.

type Doc = Record<string, unknown>;

// Fields the form owns at each level. Everything else is preserved.
const OWNED = {
  root: ['kind', 'apiVersion', 'archiveSize', 'mirror'],
  mirror: ['platform', 'operators', 'additionalImages'],
  platform: ['channels', 'graph'],
  platformChannel: ['name', 'type', 'minVersion', 'maxVersion', 'shortestPath'],
  catalog: ['catalog', 'packages'],
  pkg: ['name', 'channels', 'defaultChannel'],
  operatorChannel: ['name', 'minVersion'],
  image: ['name'],
};

const isObject = (value: unknown): value is Doc =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): Doc[] => (Array.isArray(value) ? value.filter(isObject) : []);

function extras(source: unknown, owned: string[]): Doc {
  if (!isObject(source)) return {};
  return Object.fromEntries(Object.entries(source).filter(([key]) => !owned.includes(key)));
}

function findBy(items: Doc[], key: string, value: unknown): Doc | undefined {
  return items.find(item => item[key] === value);
}

function mergeList(
  formItems: unknown,
  preservedItems: unknown,
  key: string,
  owned: string[],
  mergeChildren?: (formItem: Doc, preservedItem: Doc) => Doc,
): Doc[] | undefined {
  if (!Array.isArray(formItems)) return undefined;
  const preserved = asArray(preservedItems);
  return formItems.map(item => {
    if (!isObject(item)) return item;
    const match = findBy(preserved, key, item[key]);
    if (!match) return item;
    const merged = { ...extras(match, owned), ...item };
    return mergeChildren ? mergeChildren(merged, match) : merged;
  });
}

function mergePackage(formPkg: Doc, preservedPkg: Doc): Doc {
  const merged: Doc = { ...formPkg };
  merged.channels = mergeList(formPkg.channels, preservedPkg.channels, 'name', OWNED.operatorChannel);

  // Keep an explicit defaultChannel from the file if the form did not compute one and the
  // channel is still selected (oc-mirror requires defaultChannel to be one of the channels).
  const channelNames = asArray(merged.channels).map(ch => ch.name);
  if (merged.defaultChannel === undefined && channelNames.includes(preservedPkg.defaultChannel)) {
    merged.defaultChannel = preservedPkg.defaultChannel;
  }

  // A package listed without channels in the file stays without a channels key.
  if (channelNames.length === 0 && !('channels' in preservedPkg)) {
    delete merged.channels;
  }
  return merged;
}

/** Overlays the form-generated config onto the loaded document, keeping unmodelled fields. */
export function mergePreservedFields<T extends Doc>(formConfig: T, preserved: Doc | null | undefined): T {
  if (!isObject(preserved)) return formConfig;

  const result: Doc = { ...extras(preserved, OWNED.root), ...formConfig };
  const formMirror = isObject(formConfig.mirror) ? formConfig.mirror : {};
  const preservedMirror = isObject(preserved.mirror) ? preserved.mirror : {};
  const mirror: Doc = { ...extras(preservedMirror, OWNED.mirror), ...formMirror };

  const platformExtras = extras(preservedMirror.platform, OWNED.platform);
  if (isObject(formMirror.platform)) {
    const platform: Doc = { ...platformExtras, ...formMirror.platform };
    const preservedPlatform = isObject(preservedMirror.platform) ? preservedMirror.platform : {};
    platform.channels = mergeList(
      formMirror.platform.channels,
      preservedPlatform.channels,
      'name',
      OWNED.platformChannel,
    );
    if (platform.channels === undefined) delete platform.channels;
    mirror.platform = platform;
  } else if (Object.keys(platformExtras).length > 0) {
    mirror.platform = platformExtras;
  }

  if (Array.isArray(formMirror.operators)) {
    mirror.operators = mergeList(formMirror.operators, preservedMirror.operators, 'catalog', OWNED.catalog,
      (formCatalog, preservedCatalog) => {
        const packages = mergeList(formCatalog.packages, preservedCatalog.packages, 'name', OWNED.pkg, mergePackage);
        return packages === undefined ? formCatalog : { ...formCatalog, packages };
      });
  }

  if (Array.isArray(formMirror.additionalImages)) {
    mirror.additionalImages = mergeList(formMirror.additionalImages, preservedMirror.additionalImages, 'name', OWNED.image);
  }

  result.mirror = mirror;
  return result as T;
}

/** Human-readable list of the fields that will be kept although the form cannot edit them. */
export function describePreservedFields(preserved: Doc | null | undefined): string[] {
  if (!isObject(preserved)) return [];
  const found: string[] = [];
  const add = (prefix: string, source: unknown, owned: string[]) => {
    Object.keys(extras(source, owned)).forEach(key => found.push(prefix ? `${prefix}.${key}` : key));
  };
  const mirror = isObject(preserved.mirror) ? preserved.mirror : {};

  add('', preserved, OWNED.root);
  add('mirror', mirror, OWNED.mirror);
  add('mirror.platform', mirror.platform, OWNED.platform);
  asArray(isObject(mirror.platform) ? mirror.platform.channels : []).forEach(ch =>
    add(`platform channel ${String(ch.name)}`, ch, OWNED.platformChannel));
  asArray(mirror.operators).forEach(catalog => {
    add(String(catalog.catalog), catalog, OWNED.catalog);
    asArray(catalog.packages).forEach(pkg => {
      add(`${String(pkg.name)}`, pkg, OWNED.pkg);
      asArray(pkg.channels).forEach(ch => add(`${String(pkg.name)} channel ${String(ch.name)}`, ch, OWNED.operatorChannel));
    });
  });
  asArray(mirror.additionalImages).forEach(img => add(String(img.name), img, OWNED.image));
  return found;
}

/**
 * Compares two operator versions with SemVer 2.0 precedence, as oc-mirror does when it filters
 * operator bundles. A prerelease sorts below its release ("2.6.14-0" < "2.6.14"), prerelease
 * identifiers compare numerically or lexically, and build metadata ("+...") is ignored.
 * Versions that are not SemVer-like compare as equal, so they are never reported.
 */
export function compareOperatorVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const match = /^v?(\d+(?:\.\d+){0,2})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
    if (!match) return null;
    const core = match[1].split('.').map(Number);
    while (core.length < 3) core.push(0);
    return { core, pre: match[2] ? match[2].split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;

  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;

  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const [pNum, qNum] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pNum && qNum && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pNum !== qNum) return pNum ? -1 : 1;
    if (!pNum && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export interface OperatorRangeError {
  operatorIndex: number;
  packageIndex: number;
  channelIndex: number;
  message: string;
}

/**
 * Finds operator channels whose minVersion is above their maxVersion in the config that will be
 * written. The form edits minVersion only; maxVersion can only come from a loaded file, so an
 * edited minimum can end up above a kept maximum. Indices follow the form's order.
 */
export function findOperatorRangeErrors(config: Doc): OperatorRangeError[] {
  const errors: OperatorRangeError[] = [];
  const mirror = isObject(config.mirror) ? config.mirror : {};
  asArray(mirror.operators).forEach((catalog, operatorIndex) => {
    asArray(catalog.packages).forEach((pkg, packageIndex) => {
      asArray(pkg.channels).forEach((channel, channelIndex) => {
        const { minVersion, maxVersion } = channel;
        if (typeof minVersion === 'string' && typeof maxVersion === 'string' && minVersion && maxVersion
          && compareOperatorVersions(minVersion, maxVersion) > 0) {
          errors.push({
            operatorIndex,
            packageIndex,
            channelIndex,
            message: `${String(pkg.name)} channel ${String(channel.name)}: min version ${minVersion} is above the max version ${maxVersion} kept from the loaded file`,
          });
        }
      });
    });
  });
  return errors;
}
