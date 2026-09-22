const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
const source = fs.readFileSync(target, 'utf8');
const marker = '            ...extraOptions,\n        };';
const patched = '            ...extraOptions,\n        };\n\n        // MediaData.__x_id is not the outgoing message ID.\n        delete message.__x_id;';

if (!source.includes(patched)) {
  if (!source.includes(marker)) throw new Error('whatsapp-web.js sendMessage layout changed; review the media patch');
  fs.writeFileSync(target, source.replace(marker, patched));
}
