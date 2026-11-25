// This harness runs in the built image: source and real Nest dependencies are /app.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const appRoot = process.env.REMNADROP_APP_ROOT ||
  (fs.existsSync('/app/package.json') ? '/app' : path.resolve(__dirname, '../../backend'));
const appRequire = Module.createRequire(path.join(appRoot, 'package.json'));
const ts = appRequire('typescript');
appRequire('reflect-metadata');

const aliases = {
  '@common/': 'src/common/', '@modules/': 'src/modules/', '@queue/': 'src/queue/',
  '@libs/contracts/': 'libs/contract/', '@contract/': 'libs/contract/',
};

function createSourceLoader(mocks = {}) {
  const cache = new Map();
  function load(relative) {
    let filename = path.isAbsolute(relative) ? relative : path.join(appRoot, relative);
    filename = [filename, filename + '.ts', filename + '.js', path.join(filename, 'index.ts')]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!filename) throw new Error('Source fixture not found: ' + relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true, emitDecoratorMetadata: false, esModuleInterop: true,
      },
    }).outputText;
    const sourceModule = new Module(filename, module);
    sourceModule.filename = filename;
    sourceModule.paths = Module._nodeModulePaths(appRoot);
    cache.set(filename, sourceModule);
    sourceModule.require = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
      for (const [prefix, directory] of Object.entries(aliases)) {
        if (name.startsWith(prefix)) return load(directory + name.slice(prefix.length));
      }
      return appRequire(name);
    };
    sourceModule._compile(compiled, filename);
    return sourceModule.exports;
  }
  return load;
}

// Use the parser wiring from main.ts, rather than recreating an assumed setup.
// In particular, the old app.use(express.json()) consumes raw bytes too early.
function mainBodyParserSetup() {
  const filename = path.join(appRoot, 'src/main.ts');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const parserStatements = [];
  let rawBody = false;
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'NestFactory.create') {
      const options = node.arguments[1];
      if (options && ts.isObjectLiteralExpression(options)) {
        rawBody = options.properties.some(property => ts.isPropertyAssignment(property)
          && property.name.getText(source) === 'rawBody'
          && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
      }
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      const target = call.expression.getText(source);
      if (target === 'app.useBodyParser' || (target === 'app.use' && call.arguments.some(argument =>
        ts.isCallExpression(argument) && argument.expression.getText(source) === 'json'))) {
        parserStatements.push(node.getText(source));
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  return {
    rawBody,
    apply(app) {
      if (!parserStatements.length) throw new Error('main.ts has no explicit JSON parser setup');
      vm.runInNewContext(parserStatements.join('\n'), { app, json: appRequire('express').json });
    },
  };
}

module.exports = { appRequire, createSourceLoader, mainBodyParserSetup };
