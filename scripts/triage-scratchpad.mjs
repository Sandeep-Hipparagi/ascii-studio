#!/usr/bin/env node

/**
 * Clean-Room Triage Script for Captured Client-Side Bundles
 *
 * Scans `/analysis_scratchpad` (relative to repo root by default), filters out
 * telemetry, analytics, authentication, and payment-gating modules, emits
 * sanitized inspection copies into `_graphics_only/`, and writes `manifest.json`
 * detailing rendering APIs, detected graphics/math signals, and line counts.
 *
 * Zero external dependencies. Read-only on original captured files.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.glsl',
  '.vert',
  '.frag',
  '.comp',
  '.wgsl',
  '.html',
  '.htm',
  '.txt',
]);

const SKIP_BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.mp4',
  '.webm',
  '.mov',
  '.mp3',
  '.wav',
  '.ogg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.zip',
  '.gz',
  '.br',
  '.map',
  '.css',
]);

const EXCLUDED_DIRS = new Set(['_graphics_only', 'node_modules', '.git']);

// --- Graphics & Math Signal Definitions ---

const SIGNAL_GROUPS = {
  webglShaders: [
    { name: 'gl_FragColor', regex: /\bgl_FragColor\b/g },
    { name: 'gl_Position', regex: /\bgl_Position\b/g },
    { name: 'gl_FragCoord', regex: /\bgl_FragCoord\b/g },
    { name: 'glsl_version_300es', regex: /#version\s+300\s+es\b/g },
    { name: 'sampler2D', regex: /\bsampler(?:2D|3D|2DArray|Cube)\b/g },
    {
      name: 'uniform_decl',
      regex: /\buniform\s+(?:highp|mediump|lowp)?\s*(?:float|int|uint|bool|vec[234]|ivec[234]|mat[234]|sampler\w*)\b/g,
    },
    { name: 'varying_or_attribute', regex: /\b(?:varying|attribute)\s+(?:float|vec[234]|mat[234])\b/g },
    { name: 'glsl_precision', regex: /\bprecision\s+(?:lowp|mediump|highp)\s+float\b/g },
    { name: 'texture_lookup', regex: /\b(?:texture2D|texelFetch|textureSize)\s*\(/g },
    { name: 'webgl_context', regex: /getContext\s*\(\s*['"`]webgl2?['"`]/g },
    {
      name: 'webgl_host_api',
      regex: /\b(?:createShader|shaderSource|compileShader|createFramebuffer|texImage2D|drawArraysInstanced|WebGL2RenderingContext|WebGLRenderingContext)\b/g,
    },
  ],
  canvas2d: [
    { name: 'fillText', regex: /\.fillText\s*\(/g },
    { name: 'strokeText', regex: /\.strokeText\s*\(/g },
    { name: 'getImageData', regex: /\.getImageData\s*\(/g },
    { name: 'putImageData', regex: /\.putImageData\s*\(/g },
    { name: 'createImageData', regex: /\.createImageData\s*\(/g },
    { name: 'measureText', regex: /\.measureText\s*\(/g },
    { name: 'drawImage', regex: /\.drawImage\s*\(/g },
    { name: 'canvas2d_context', regex: /getContext\s*\(\s*['"`]2d['"`]/g },
    { name: 'CanvasRenderingContext2D', regex: /\b(?:Offscreen)?CanvasRenderingContext2D\b/g },
  ],
  webgpu: [
    { name: 'navigator.gpu', regex: /\bnavigator\.gpu\b/g },
    {
      name: 'webgpu_pipeline',
      regex: /\b(?:requestAdapter|createShaderModule|createComputePipeline|createRenderPipeline|GPUBuffer|GPUTexture)\b/g,
    },
    { name: 'wgsl_stage', regex: /@(?:compute|fragment|vertex|group|binding)\b/g },
  ],
  wasm: [
    {
      name: 'webassembly_api',
      regex: /\b(?:WebAssembly\.(?:instantiate|compile|instantiateStreaming)|__wbindgen_)\b/g,
    },
  ],
  mathKernels: [
    { name: 'Sobel', regex: /\bsobel\b/gi },
    { name: 'Scharr/Prewitt', regex: /\b(?:scharr|prewitt)\b/gi },
    { name: 'DoG/Laplacian', regex: /\b(?:laplacian|differenceOfGaussians|gaussianBlur)\b/gi },
    { name: 'Bayer', regex: /\bbayer\b/gi },
    { name: 'ErrorDiffusion', regex: /\b(?:floyd[-_]?steinberg|atkinson|stucki|error[-_]?diffusion)\b/gi },
    { name: 'OrderedDither', regex: /\b(?:ordered[-_]?dither|blue[-_]?noise)\b/gi },
    { name: 'Perlin/Simplex', regex: /\b(?:perlin|simplex|snoise|cnoise|pnoise)\b/gi },
    { name: 'fBm/Curl/Worley', regex: /\b(?:fbm|curlNoise|worley|voronoi|domainWarp)\b/gi },
    { name: 'ReactionDiffusion', regex: /\b(?:gray[-_]?scott|reaction[-_]?diffusion)\b/gi },
    { name: 'SDF/Raymarch', regex: /\b(?:raymarch|signedDistance|sdBox|sdSphere|sdCircle)\b/gi },
    {
      name: 'BT.709/BT.601_Luminance',
      regex: /(?:0\.2126[\s\S]{0,80}0\.7152[\s\S]{0,80}0\.0722|0\.299[\s\S]{0,80}0\.587[\s\S]{0,80}0\.114)/g,
    },
  ],
};

// --- Non-Graphics Exclusion Rules (Telemetry, Analytics, Auth, Payment) ---

const EXCLUSION_CATEGORIES = {
  telemetry: {
    pathPatterns: [
      /sentry/i,
      /datadog/i,
      /dd[-_]?rum/i,
      /logrocket/i,
      /bugsnag/i,
      /rollbar/i,
      /newrelic/i,
      /speed[-_]?insights/i,
    ],
    contentPatterns: [
      /\bSentry\.init\b/,
      /\bcaptureException\b/,
      /ingest(?:\.[a-z0-9-]+)*\.sentry\.io/i,
      /@sentry\/(?:browser|nextjs|react|core)/,
      /\bDD_RUM\b/,
      /browser-intake-datadoghq\.com/i,
      /\bLogRocket\.init\b/,
      /@vercel\/speed-insights/,
    ],
  },
  analytics: {
    pathPatterns: [
      /posthog/i,
      /mixpanel/i,
      /amplitude/i,
      /segment/i,
      /google[-_]?analytics/i,
      /googletagmanager/i,
      /\bgtag\b/i,
      /fullstory/i,
      /hotjar/i,
      /plausible/i,
      /umami/i,
      /clarity/i,
      /vercel[-_]?analytics/i,
    ],
    contentPatterns: [
      /\bposthog\.init\b/,
      /app\.posthog\.com|us\.i\.posthog\.com|eu\.i\.posthog\.com/i,
      /\bmixpanel\.(?:init|track)\b/,
      /\bamplitude\.(?:init|logEvent|track)\b/,
      /googletagmanager\.com\/gtag/i,
      /google-analytics\.com\/(?:analytics|g\/collect)/i,
      /cdn\.segment\.com\/analytics\.js/i,
      /plausible\.io\/js\//i,
      /@vercel\/analytics/,
    ],
  },
  authentication: {
    pathPatterns: [
      /\bclerk\b/i,
      /\bauth0\b/i,
      /next[-_]?auth/i,
      /firebase[-_]?auth/i,
      /\bgotrue\b/i,
      /cognito/i,
      /\bstytch\b/i,
      /\bworkos\b/i,
      /turnstile/i,
      /recaptcha/i,
      /hcaptcha/i,
    ],
    contentPatterns: [
      /@clerk\/(?:nextjs|clerk-react|clerk-js)/,
      /\bClerkProvider\b/,
      /\.clerk\.accounts\.dev/i,
      /@auth0\/auth0-react/,
      /\bAuth0Provider\b/,
      /\bGoTrueClient\b/,
      /cognito-idp\./i,
      /challenges\.cloudflare\.com\/turnstile/i,
    ],
  },
  paymentGating: {
    pathPatterns: [
      /\bstripe\b/i,
      /lemonsqueezy/i,
      /\bpaddle\b/i,
      /gumroad/i,
      /chargebee/i,
      /revenuecat/i,
      /braintree/i,
      /paywall/i,
      /checkout/i,
      /billing/i,
    ],
    contentPatterns: [
      /js\.stripe\.com/i,
      /@stripe\/(?:stripe-js|react-stripe-js)/,
      /\bloadStripe\b/,
      /\bStripe\s*\(\s*['"`]pk_(?:live|test)_/,
      /assets\.lemonsqueezy\.com/i,
      /cdn\.paddle\.com/i,
      /\bPaddle\.(?:Setup|Initialize|Checkout)\b/,
      /\bcreateCheckoutSession\b/,
    ],
  },
};

// --- CLI Argument Parsing ---

function parseArgs(argv) {
  const cwd = process.cwd();
  const options = {
    dir: path.resolve(cwd, 'analysis_scratchpad'),
    out: null,
    cleanDir: null,
    emitClean: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir' && argv[i + 1]) {
      options.dir = path.resolve(cwd, argv[++i]);
    } else if (arg === '--out' && argv[i + 1]) {
      options.out = path.resolve(cwd, argv[++i]);
    } else if (arg === '--clean-dir' && argv[i + 1]) {
      options.cleanDir = path.resolve(cwd, argv[++i]);
    } else if (arg === '--no-emit-clean') {
      options.emitClean = false;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  options.out ??= path.join(options.dir, 'manifest.json');
  options.cleanDir ??= path.join(options.dir, '_graphics_only');
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/triage-scratchpad.mjs [options]

Options:
  --dir <path>         Scratchpad directory to scan (default: ./analysis_scratchpad)
  --out <path>         Output manifest path (default: <dir>/manifest.json)
  --clean-dir <path>   Output folder for stripped graphics copies (default: <dir>/_graphics_only)
  --no-emit-clean      Only generate manifest.json without writing stripped copies
  -h, --help           Show this help message`);
}

// --- Filesystem Traversal ---

async function walkFiles(rootDir, currentDir = rootDir, acc = []) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await walkFiles(rootDir, fullPath, acc);
    } else if (entry.isFile()) {
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      if (relPath === 'manifest.json') continue;
      acc.push({ fullPath, relPath });
    }
  }
  return acc;
}

// --- Analysis Helpers ---

function isWasmBinary(buffer, ext) {
  if (ext === '.wasm') return true;
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x61 &&
    buffer[2] === 0x73 &&
    buffer[3] === 0x6d
  );
}

function estimateLines(text, byteSize) {
  const rawLineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  const avgLineLength = rawLineCount > 0 ? text.length / rawLineCount : 0;
  const isMinified = avgLineLength > 220;

  if (!isMinified) {
    return {
      approximateLineCount: rawLineCount,
      rawLineCount,
      isMinified: false,
    };
  }

  // Minified bundles pack thousands of statements onto 1-5 lines;
  // approximate formatted lines via statement delimiters or ~45 bytes/line.
  const delimiterMatches = text.match(/[;{}]/g);
  const delimiterEstimate = delimiterMatches ? delimiterMatches.length : 0;
  const byteEstimate = Math.ceil(byteSize / 45);
  return {
    approximateLineCount: Math.max(rawLineCount, delimiterEstimate, byteEstimate),
    rawLineCount,
    isMinified: true,
  };
}

function detectGraphicsSignals(text) {
  const signals = {
    webglShaders: [],
    canvas2d: [],
    mathKernels: [],
    webgpu: [],
    wasm: [],
  };

  for (const [group, patterns] of Object.entries(SIGNAL_GROUPS)) {
    for (const { name, regex } of patterns) {
      regex.lastIndex = 0;
      if (regex.test(text)) {
        signals[group].push(name);
      }
    }
  }

  const totalSignals = Object.values(signals).reduce((sum, list) => sum + list.length, 0);
  return { signals, totalSignals };
}

function detectExclusionMatches(relPath, text) {
  const matches = [];
  for (const [category, rules] of Object.entries(EXCLUSION_CATEGORIES)) {
    const matchedReasons = [];
    for (const pat of rules.pathPatterns) {
      if (pat.test(relPath)) matchedReasons.push(`path:${pat.source}`);
    }
    for (const pat of rules.contentPatterns) {
      if (pat.test(text)) matchedReasons.push(`content:${pat.source}`);
    }
    if (matchedReasons.length > 0) {
      matches.push({ category, reasons: matchedReasons });
    }
  }
  return matches;
}

function classifyRenderingApis(signals, isBinaryWasm) {
  const apis = [];
  if (isBinaryWasm || signals.wasm.length > 0) apis.push('WASM');
  if (signals.webgpu.length > 0) apis.push('WebGPU');
  if (signals.webglShaders.length > 0) apis.push('WebGL1/2');
  if (signals.canvas2d.length > 0) apis.push('Canvas2D');

  if (apis.length === 0 && signals.mathKernels.length > 0) {
    return {
      renderingApi: 'MathKernel/Shared',
      renderingApis: ['MathKernel/Shared'],
    };
  }

  return {
    renderingApi: apis[0] ?? 'Unknown',
    renderingApis: apis,
  };
}

/**
 * Strips identifiable inline telemetry, analytics, auth, and payment URLs or
 * single-statement SDK initializers from mixed bundles so inspection copies
 * stay focused on graphics logic without breaking surrounding context.
 */
function stripInlineNonGraphicsNoise(text, exclusionMatches) {
  if (exclusionMatches.length === 0) {
    return { sanitizedText: text, strippedCategories: [] };
  }

  let sanitizedText = text;
  const strippedCategories = new Set();

  const inlineStripRules = [
    {
      category: 'telemetry',
      regex: /(?:Sentry\.init|LogRocket\.init)\s*\([^;]*\);?/g,
    },
    {
      category: 'telemetry',
      regex: /https?:\/\/[a-z0-9.-]*(?:sentry\.io|browser-intake-datadoghq\.com)[^\s'"`)]*/gi,
    },
    {
      category: 'analytics',
      regex: /(?:posthog\.init|mixpanel\.(?:init|track)|amplitude\.(?:init|logEvent|track)|gtag)\s*\([^;]*\);?/g,
    },
    {
      category: 'analytics',
      regex: /https?:\/\/[a-z0-9.-]*(?:posthog\.com|googletagmanager\.com|google-analytics\.com|segment\.com|plausible\.io)[^\s'"`)]*/gi,
    },
    {
      category: 'authentication',
      regex: /https?:\/\/[a-z0-9.-]*(?:clerk\.accounts\.dev|challenges\.cloudflare\.com\/turnstile)[^\s'"`)]*/gi,
    },
    {
      category: 'paymentGating',
      regex: /(?:loadStripe|Paddle\.(?:Setup|Initialize))\s*\([^;]*\);?/g,
    },
    {
      category: 'paymentGating',
      regex: /https?:\/\/[a-z0-9.-]*(?:js\.stripe\.com|lemonsqueezy\.com|cdn\.paddle\.com)[^\s'"`)]*/gi,
    },
  ];

  for (const rule of inlineStripRules) {
    const replaced = sanitizedText.replace(rule.regex, () => {
      strippedCategories.add(rule.category);
      return `/* [STRIPPED:${rule.category}] */`;
    });
    sanitizedText = replaced;
  }

  return {
    sanitizedText,
    strippedCategories: [...strippedCategories],
  };
}

// --- Main Execution ---

async function run() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const stat = await fs.stat(options.dir);
    if (!stat.isDirectory()) {
      console.error(`Error: ${options.dir} is not a directory.`);
      process.exit(1);
    }
  } catch {
    console.error(
      `Scratchpad directory not found: ${options.dir}\n` +
        `Create it and place captured client-side bundle artifacts inside, or pass --dir <path>.`
    );
    process.exit(1);
  }

  if (options.emitClean) {
    await fs.rm(options.cleanDir, { recursive: true, force: true });
    await fs.mkdir(options.cleanDir, { recursive: true });
  }

  const files = await walkFiles(options.dir);
  const graphicsModules = [];
  const excludedModules = [];
  const excludedByCategory = {
    telemetry: 0,
    analytics: 0,
    authentication: 0,
    paymentGating: 0,
  };
  let skippedNonGraphicsCount = 0;

  for (const { fullPath, relPath } of files) {
    const ext = path.extname(relPath).toLowerCase();
    if (SKIP_BINARY_EXTENSIONS.has(ext)) {
      skippedNonGraphicsCount += 1;
      continue;
    }

    const buffer = await fs.readFile(fullPath);
    const binaryWasm = isWasmBinary(buffer, ext);

    if (binaryWasm) {
      const { renderingApi, renderingApis } = classifyRenderingApis(
        { webglShaders: [], canvas2d: [], mathKernels: [], webgpu: [], wasm: ['wasm_binary'] },
        true
      );
      graphicsModules.push({
        path: relPath,
        sanitizedPath: null,
        approximateLineCount: 0,
        rawLineCount: 0,
        byteSize: buffer.length,
        isMinified: false,
        isBinary: true,
        renderingApi,
        renderingApis,
        signals: {
          webglShaders: [],
          canvas2d: [],
          mathKernels: [],
          webgpu: [],
          wasm: ['wasm_binary_magic'],
        },
        strippedInlineCategories: [],
      });
      continue;
    }

    if (!TEXT_EXTENSIONS.has(ext) && ext !== '') {
      skippedNonGraphicsCount += 1;
      continue;
    }

    const text = buffer.toString('utf8');
    const { signals, totalSignals } = detectGraphicsSignals(text);
    const exclusionMatches = detectExclusionMatches(relPath, text);

    // Pure telemetry / analytics / auth / payment modules -> exclude completely
    if (totalSignals === 0 && exclusionMatches.length > 0) {
      const categories = exclusionMatches.map((m) => m.category);
      for (const cat of categories) {
        if (cat in excludedByCategory) excludedByCategory[cat] += 1;
      }
      excludedModules.push({
        path: relPath,
        categories,
        reasons: exclusionMatches.flatMap((m) => m.reasons),
      });
      continue;
    }

    // Unrelated non-graphics code (e.g., generic router/UI utilities)
    if (totalSignals === 0) {
      skippedNonGraphicsCount += 1;
      continue;
    }

    const lineMetrics = estimateLines(text, buffer.length);
    const { renderingApi, renderingApis } = classifyRenderingApis(signals, false);

    let sanitizedRelPath = null;
    let strippedInlineCategories = [];

    if (options.emitClean) {
      const { sanitizedText, strippedCategories } = stripInlineNonGraphicsNoise(
        text,
        exclusionMatches
      );
      strippedInlineCategories = strippedCategories;
      sanitizedRelPath = path
        .join(path.basename(options.cleanDir), relPath)
        .replace(/\\/g, '/');
      const targetCleanPath = path.join(options.cleanDir, relPath);
      await fs.mkdir(path.dirname(targetCleanPath), { recursive: true });
      await fs.writeFile(targetCleanPath, sanitizedText, 'utf8');
    }

    graphicsModules.push({
      path: relPath,
      sanitizedPath: sanitizedRelPath,
      approximateLineCount: lineMetrics.approximateLineCount,
      rawLineCount: lineMetrics.rawLineCount,
      byteSize: buffer.length,
      isMinified: lineMetrics.isMinified,
      isBinary: false,
      renderingApi,
      renderingApis,
      signals,
      strippedInlineCategories,
    });
  }

  graphicsModules.sort((a, b) => b.approximateLineCount - a.approximateLineCount);

  const apiBreakdown = {};
  for (const mod of graphicsModules) {
    for (const api of mod.renderingApis) {
      apiBreakdown[api] = (apiBreakdown[api] ?? 0) + 1;
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    scratchpadDir: path.basename(options.dir),
    cleanOutputDir: options.emitClean ? path.relative(options.dir, options.cleanDir).replace(/\\/g, '/') : null,
    summary: {
      totalFilesScanned: files.length,
      graphicsModulesCount: graphicsModules.length,
      excludedModulesCount: excludedModules.length,
      skippedNonGraphicsCount,
      excludedByCategory,
      apiBreakdown,
    },
    modules: graphicsModules,
    excluded: excludedModules,
  };

  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(
    `Triage complete:\n` +
      `  Scanned:  ${files.length} files\n` +
      `  Graphics: ${graphicsModules.length} modules\n` +
      `  Excluded: ${excludedModules.length} telemetry/analytics/auth/payment modules\n` +
      `  Skipped:  ${skippedNonGraphicsCount} non-graphics/asset files\n` +
      `  Manifest: ${options.out}` +
      (options.emitClean ? `\n  Clean dir: ${options.cleanDir}` : '')
  );
}

run().catch((err) => {
  console.error('Triage failed:', err);
  process.exit(1);
});
