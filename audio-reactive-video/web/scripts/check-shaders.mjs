import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parse as parseGlsl } from "@shaderfrog/glsl-parser/index.js";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.node.js";

const projectRoot = process.cwd();
const shadersRoot = path.join(projectRoot, "app", "shaders");
const supportedExtensions = new Set([".glsl", ".wgsl"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }

      if (supportedExtensions.has(path.extname(entry.name))) {
        return [fullPath];
      }

      return [];
    }),
  );

  return files.flat();
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return JSON.stringify(error);
}

function checkGlslShader(source, filePath) {
  parseGlsl(source, { quiet: true, stage: inferShaderStage(filePath) });
}

function checkWgslShader(source) {
  new WgslReflect(source);
}

function inferShaderStage(filePath) {
  const baseName = path.basename(filePath);
  if (baseName.includes(".vert.")) {
    return "vertex";
  }
  if (baseName.includes(".frag.")) {
    return "fragment";
  }
  return undefined;
}

async function main() {
  const shaderFiles = (await walk(shadersRoot)).sort();
  let hasErrors = false;

  for (const filePath of shaderFiles) {
    const source = await readFile(filePath, "utf8");
    const relativePath = path.relative(projectRoot, filePath);

    try {
      if (filePath.endsWith(".glsl")) {
        checkGlslShader(source, filePath);
      } else if (filePath.endsWith(".wgsl")) {
        checkWgslShader(source);
      }

      console.log(`ok ${relativePath}`);
    } catch (error) {
      hasErrors = true;
      console.error(`error ${relativePath}`);
      console.error(formatError(error));
    }
  }

  if (hasErrors) {
    process.exitCode = 1;
    return;
  }

  console.log(`validated ${shaderFiles.length} shader files`);
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
