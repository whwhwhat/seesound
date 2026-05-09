import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

function printUsage() {
  console.log(`Usage:
  npm run convert:webm -- /path/to/input.webm
  npm run convert:webm -- /path/to/one.webm /path/to/two.webm
  npm run convert:webm -- --input /path/to/input.webm --output /path/to/output.mp4

Notes:
  - When --output is omitted, the script writes an .mp4 next to the .webm file.
  - Multiple positional .webm inputs are converted in sequence.
`);
}

function parseArgs(argv) {
  const inputs = [];
  let explicitOutput = "";

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--input" || arg === "-i") && next) {
      inputs.push(next);
      index += 1;
      continue;
    }
    if ((arg === "--output" || arg === "-o") && next) {
      explicitOutput = next;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    inputs.push(arg);
  }

  if (inputs.length === 0) {
    printUsage();
    process.exit(1);
  }

  if (explicitOutput && inputs.length !== 1) {
    throw new Error("--output can only be used with a single input file.");
  }

  return {
    inputs: inputs.map((input) => resolve(input)),
    output: explicitOutput ? resolve(explicitOutput) : "",
  };
}

async function assertReadableFile(filePath) {
  await access(filePath, constants.R_OK);
}

function defaultOutputFor(inputPath) {
  const directory = dirname(inputPath);
  const stem = basename(inputPath, extname(inputPath));
  return join(directory, `${stem}.mp4`);
}

function runFfmpeg(inputPath, outputPath) {
  return new Promise((resolveRun, rejectRun) => {
    const process = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "320k",
      outputPath,
    ], {
      stdio: "inherit",
    });

    process.on("error", rejectRun);
    process.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function main() {
  const { inputs, output } = parseArgs(process.argv);

  for (const inputPath of inputs) {
    await assertReadableFile(inputPath);
  }

  const tasks = inputs.map((inputPath, index) => ({
    inputPath,
    outputPath: output || defaultOutputFor(inputPath),
    label: inputs.length > 1 ? `[${index + 1}/${inputs.length}] ` : "",
  }));

  for (const task of tasks) {
    console.log(`${task.label}Converting ${task.inputPath} -> ${task.outputPath}`);
    await runFfmpeg(task.inputPath, task.outputPath);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
