import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

/** Writes a one-package file-based catalog under `<configsDir>/datapower-operator/`. */
export async function writeMinimalFbc(configsDir: string): Promise<void> {
  const operatorDir = path.join(configsDir, 'datapower-operator');
  await mkdir(operatorDir, { recursive: true });
  const docs = [
    { schema: 'olm.package', name: 'datapower-operator', defaultChannel: 'v1' },
    {
      schema: 'olm.channel',
      package: 'datapower-operator',
      name: 'v1',
      entries: [{ name: 'datapower-operator.v1.0.0' }],
    },
    {
      schema: 'olm.bundle',
      package: 'datapower-operator',
      name: 'datapower-operator.v1.0.0',
      image: 'icr.io/cpopen/datapower-operator-bundle@sha256:abc',
      properties: [
        {
          type: 'olm.package',
          value: { packageName: 'datapower-operator', version: '1.0.0' },
        },
      ],
    },
  ];
  await writeFile(
    path.join(operatorDir, 'catalog.json'),
    docs.map((doc) => JSON.stringify(doc)).join('\n') + '\n',
  );
}
