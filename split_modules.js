const fs = require('fs');

const content = fs.readFileSync('prompts/sapInterpreter.js', 'utf8');

// Find the MODULE_CHUNKS object
const startIdx = content.indexOf('const MODULE_CHUNKS = {');
const endMatch = content.match(/\/\/ ═══════════════════════════════════════════════════════════════\r?\n\/\/  RELATIONSHIPS/);

if (startIdx === -1 || !endMatch) {
  console.error("Could not find MODULE_CHUNKS");
  process.exit(1);
}

const endIdx = endMatch.index;

const chunksBlock = content.substring(startIdx, endIdx);

// Using a module to extract keys and values safely
const extractChunks = () => {
  const result = {};
  const regex = /^\s*([A-Z]{2,5}):\s*`([\s\S]*?)`,?\n(?=\s*[A-Z]{2,5}:\s*`|\s*};\s*$)/gm;
  let match;
  while ((match = regex.exec(chunksBlock)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
};

const chunks = extractChunks();

let newModuleChunks = 'const MODULE_CHUNKS = {\n';

for (const [mod, val] of Object.entries(chunks)) {
  const code = 'module.exports = `' + val + '`;\n';
  const filePath = `prompts/modules/${mod.toLowerCase()}.js`;
  fs.writeFileSync(filePath, code);
  console.log('Created ' + filePath);
  
  newModuleChunks += `  ${mod}: require('./modules/${mod.toLowerCase()}.js'),\n`;
}

newModuleChunks += '};\n';

const newContent = content.substring(0, startIdx) + newModuleChunks + content.substring(endIdx);
fs.writeFileSync('prompts/sapInterpreter.js', newContent);
console.log('Successfully updated sapInterpreter.js');

