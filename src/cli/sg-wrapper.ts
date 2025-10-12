import { parseArgs } from "node:util";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { YAML } from "bun";

type Config = {
  ruleDirs?: string[];
  utilDirs?: string[];
  [key: string]: unknown;
};

type Replacements = Record<string, string>;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    funcName: {
      type: "string",
    },
    typeName: {
      type: "string",
    },
    config: {
      type: "string",
    },
    json: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: true,
});

if (positionals.length === 0) {
  console.error("error: provide at least one path to scan");
  process.exitCode = 1;
  process.exit();
}

const funcName = values.funcName ?? "foo";
const typeName = values.typeName ?? "Baz";
const jsonStyle = values.json ?? "stream";

const replacements: Replacements = {
  __FUNC_NAME__: funcName,
  __TYPE_NAME__: typeName,
};

const configPath = resolve(
  values.config ?? join(process.cwd(), "ast-grep-playground", "sgconfig.yml"),
);

async function loadConfig(
  path: string,
): Promise<{ config: Config; dir: string }> {
  const raw = await readFile(path, "utf8");
  const config = YAML.parse(raw) as Config;
  if (!config || typeof config !== "object") {
    throw new Error(`invalid config at ${path}`);
  }
  return { config, dir: dirname(path) };
}

async function copyWithSubstitution(
  src: string,
  dest: string,
  map: Replacements,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyWithSubstitution(srcPath, destPath, map);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
        const content = await readFile(srcPath, "utf8");
        const replaced = applyReplacements(content, map);
        await writeFile(destPath, replaced);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }
}

function applyReplacements(input: string, map: Replacements): string {
  let result = input;
  for (const [token, value] of Object.entries(map)) {
    result = result.split(token).join(value);
  }
  return result;
}

async function prepareRuleDirectories(
  config: Config,
  configDir: string,
  tempDir: string,
  map: Replacements,
): Promise<{ ruleDirs: string[]; utilDirs: string[] }> {
  const ruleRoot = join(tempDir, "rules");
  const utilRoot = join(tempDir, "utils");
  const nextRuleDirs: string[] = [];
  const nextUtilDirs: string[] = [];

  const ruleDirs = Array.isArray(config.ruleDirs) ? config.ruleDirs : [];
  for (const [index, dir] of ruleDirs.entries()) {
    const abs = resolve(configDir, dir);
    const dest = join(ruleRoot, `${index}-${basename(dir)}`);
    await copyWithSubstitution(abs, dest, map);
    nextRuleDirs.push(relative(tempDir, dest));
  }

  const utilDirs = Array.isArray(config.utilDirs) ? config.utilDirs : [];
  for (const [index, dir] of utilDirs.entries()) {
    const abs = resolve(configDir, dir);
    const dest = join(utilRoot, `${index}-${basename(dir)}`);
    await copyWithSubstitution(abs, dest, map);
    nextUtilDirs.push(relative(tempDir, dest));
  }

  return { ruleDirs: nextRuleDirs, utilDirs: nextUtilDirs };
}

async function run(): Promise<void> {
  const { config, dir } = await loadConfig(configPath);
  const workDir = await mkdtemp(join(tmpdir(), "sg-wrapper-"));

  try {
    const { ruleDirs, utilDirs } = await prepareRuleDirectories(
      config,
      dir,
      workDir,
      replacements,
    );
    const generatedConfig: Config = {
      ...config,
      ruleDirs,
    };
    if (utilDirs.length > 0) {
      generatedConfig.utilDirs = utilDirs;
    } else {
      delete generatedConfig.utilDirs;
    }

    const generatedConfigPath = join(workDir, "sgconfig.yml");
    await writeFile(generatedConfigPath, YAML.stringify(generatedConfig));

    const sgArgs = [
      "scan",
      "--config",
      generatedConfigPath,
      // `--json=${jsonStyle}`,
      ...positionals.map((path) => resolve(path)),
    ];

    const proc = Bun.spawn(["sg", ...sgArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutPromise = proc.stdout?.text();
    const stderrPromise = proc.stderr?.text();
    const exitCode = await proc.exited;
    if (stdoutPromise) {
      const output = await stdoutPromise;
      if (output) {
        process.stdout.write(output);
      }
    }
    if (stderrPromise) {
      const errorOutput = await stderrPromise;
      if (errorOutput) {
        process.stderr.write(errorOutput);
      }
    }

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
