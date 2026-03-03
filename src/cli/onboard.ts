/**
 * J.A.R.V.I.S. Interactive Onboard Wizard
 *
 * Full first-time setup: LLM provider, API keys, TTS, STT,
 * channels, personality, authority, autostart.
 * All steps are skippable except LLM configuration.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import {
  c, printBanner, printStep, printOk, printWarn, printErr, printInfo,
  ask, askSecret, askYesNo, askChoice, startSpinner, closeRL, detectPlatform,
} from './helpers.ts';
import { DEFAULT_CONFIG, type JarvisConfig } from '../config/types.ts';
import { loadConfig, saveConfig } from '../config/loader.ts';
import { installAutostart, getAutostartName } from './autostart.ts';
import { runDependencyCheck } from './deps.ts';

const JARVIS_DIR = join(homedir(), '.jarvis');
const CONFIG_PATH = join(JARVIS_DIR, 'config.yaml');
const TOTAL_STEPS = 10;

export async function runOnboard(): Promise<void> {
  printBanner();
  console.log(c.bold('Welcome to the J.A.R.V.I.S. setup wizard!\n'));
  console.log('This wizard will configure your personal AI assistant.');
  console.log(c.dim('Most steps can be skipped and configured later.\n'));

  // Load existing config or start with defaults
  let config: JarvisConfig;
  if (existsSync(CONFIG_PATH)) {
    console.log(c.dim(`Found existing config at ${CONFIG_PATH}`));
    const useExisting = await askYesNo('Use existing config as base?', true);
    config = useExisting ? await loadConfig() : structuredClone(DEFAULT_CONFIG);
  } else {
    config = structuredClone(DEFAULT_CONFIG);
  }

  // Ensure data directory
  if (!existsSync(JARVIS_DIR)) {
    mkdirSync(JARVIS_DIR, { recursive: true });
  }

  // ── Step 1: LLM Provider ──────────────────────────────────────────

  printStep(1, TOTAL_STEPS, 'LLM Provider');
  console.log('  JARVIS needs at least one AI model to function.\n');

  const provider = await askChoice('Choose your primary LLM provider:', [
    { label: 'Anthropic (Claude)', value: 'anthropic' as const, description: 'Best quality, recommended' },
    { label: 'OpenAI (GPT-4)', value: 'openai' as const, description: 'Good alternative' },
    { label: 'Ollama (Local)', value: 'ollama' as const, description: 'Free, runs locally' },
  ], config.llm.primary as any);

  config.llm.primary = provider;

  // Get API key for cloud providers
  if (provider === 'anthropic') {
    const existing = config.llm.anthropic?.api_key;
    if (existing && existing.startsWith('sk-')) {
      const keep = await askYesNo(`API key found (${existing.slice(0, 10)}...). Keep it?`, true);
      if (!keep) {
        const key = await askSecret('Enter your Anthropic API key');
        if (key) config.llm.anthropic = { ...config.llm.anthropic, api_key: key };
      }
    } else {
      const key = await askSecret('Enter your Anthropic API key (from console.anthropic.com)');
      if (key) {
        config.llm.anthropic = { ...config.llm.anthropic, api_key: key };
      } else {
        printWarn('No API key set. JARVIS won\'t work without one.');
        printInfo('Set it later in ~/.jarvis/config.yaml');
      }
    }

    const model = await ask('Claude model', config.llm.anthropic?.model ?? 'claude-sonnet-4-5-20250929');
    if (config.llm.anthropic) config.llm.anthropic.model = model;

  } else if (provider === 'openai') {
    const existing = config.llm.openai?.api_key;
    if (existing && existing.startsWith('sk-')) {
      const keep = await askYesNo(`API key found (${existing.slice(0, 10)}...). Keep it?`, true);
      if (!keep) {
        const key = await askSecret('Enter your OpenAI API key');
        if (key) config.llm.openai = { ...config.llm.openai, api_key: key };
      }
    } else {
      const key = await askSecret('Enter your OpenAI API key (from platform.openai.com)');
      if (key) {
        config.llm.openai = { ...config.llm.openai, api_key: key };
      } else {
        printWarn('No API key set. JARVIS won\'t work without one.');
      }
    }

    const model = await ask('OpenAI model', config.llm.openai?.model ?? 'gpt-4o');
    if (config.llm.openai) config.llm.openai.model = model;

  } else if (provider === 'ollama') {
    const url = await ask('Ollama base URL', config.llm.ollama?.base_url ?? 'http://localhost:11434');
    const model = await ask('Ollama model', config.llm.ollama?.model ?? 'llama3');
    config.llm.ollama = { base_url: url, model };
    printInfo('Make sure Ollama is running: ollama serve');
  }

  // Test connectivity
  const testConn = await askYesNo('Test LLM connectivity?', true);
  if (testConn) {
    const spin = startSpinner('Testing connection...');
    try {
      const { LLMManager, AnthropicProvider, OpenAIProvider, OllamaProvider } = await import('../llm/index.ts');
      const manager = new LLMManager();

      if (provider === 'anthropic' && config.llm.anthropic?.api_key) {
        manager.registerProvider(new AnthropicProvider(config.llm.anthropic.api_key, config.llm.anthropic.model));
      } else if (provider === 'openai' && config.llm.openai?.api_key) {
        manager.registerProvider(new OpenAIProvider(config.llm.openai.api_key, config.llm.openai.model));
      } else if (provider === 'ollama') {
        manager.registerProvider(new OllamaProvider(config.llm.ollama?.base_url, config.llm.ollama?.model));
      }

      manager.setPrimary(provider);
      const resp = await Promise.race([
        manager.chat(
          [{ role: 'user', content: 'Say "JARVIS online" in 3 words.' }],
          { max_tokens: 20 },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timed out (15s)')), 15_000),
        ),
      ]);
      spin.stop(`Connected! Model: ${resp.model}`);
    } catch (err) {
      spin.stop();
      printErr(`Connection failed: ${err}`);
      printInfo('Check your API key and try again later.');
    }
  }

  // Fallback providers
  config.llm.fallback = ['anthropic', 'openai', 'ollama'].filter(p => p !== provider);

  // ── Step 2: Fallback API Keys ─────────────────────────────────────

  printStep(2, TOTAL_STEPS, 'Fallback Providers');
  console.log('  Optional: configure backup LLM providers.\n');

  const setupFallbacks = await askYesNo('Configure fallback providers?', false);
  if (setupFallbacks) {
    for (const fb of config.llm.fallback) {
      if (fb === 'anthropic' && (!config.llm.anthropic?.api_key || config.llm.anthropic.api_key === '')) {
        const key = await askSecret('Anthropic API key (for fallback)');
        if (key) config.llm.anthropic = { ...config.llm.anthropic, api_key: key, model: config.llm.anthropic?.model ?? 'claude-sonnet-4-5-20250929' };
      } else if (fb === 'openai' && (!config.llm.openai?.api_key || config.llm.openai.api_key === '')) {
        const key = await askSecret('OpenAI API key (for fallback)');
        if (key) config.llm.openai = { ...config.llm.openai, api_key: key, model: config.llm.openai?.model ?? 'gpt-4o' };
      } else if (fb === 'ollama') {
        const setupOllama = await askYesNo('Configure Ollama as fallback?', false);
        if (setupOllama) {
          const url = await ask('Ollama URL', 'http://localhost:11434');
          const model = await ask('Ollama model', 'llama3');
          config.llm.ollama = { base_url: url, model };
        }
      }
    }
  } else {
    printInfo('Skipped. You can add fallback providers later in config.');
  }

  // ── Step 3: System Dependencies ─────────────────────────────────

  printStep(3, TOTAL_STEPS, 'System Dependencies');
  console.log('  Checking for optional system tools JARVIS can use.\n');

  await runDependencyCheck(config);

  // ── Step 4: TTS (Text-to-Speech) ─────────────────────────────────

  printStep(4, TOTAL_STEPS, 'Voice Output (TTS)');
  console.log('  JARVIS can speak responses aloud using Microsoft Edge TTS.\n');

  const enableTTS = await askYesNo('Enable text-to-speech?', false);
  config.tts = config.tts || { enabled: false };
  config.tts.enabled = enableTTS;

  if (enableTTS) {
    config.tts.provider = 'edge';
    const voice = await ask('TTS voice', config.tts.voice ?? 'en-US-GuyNeural');
    config.tts.voice = voice;
    printInfo('Popular voices: en-US-GuyNeural, en-US-AriaNeural, en-GB-RyanNeural');
  } else {
    printInfo('Skipped. Enable later in config.');
  }

  // ── Step 5: STT (Speech-to-Text) ─────────────────────────────────

  printStep(5, TOTAL_STEPS, 'Voice Input (STT)');
  console.log('  For voice commands via the dashboard microphone button.\n');

  const setupSTT = await askYesNo('Configure speech-to-text?', false);
  if (setupSTT) {
    const sttProvider = await askChoice('STT provider:', [
      { label: 'OpenAI Whisper', value: 'openai' as const, description: 'Best accuracy, uses OpenAI API key' },
      { label: 'Groq Whisper', value: 'groq' as const, description: 'Fast, free tier available' },
      { label: 'Local Whisper', value: 'local' as const, description: 'Self-hosted, fully private' },
    ], config.stt?.provider as any ?? 'openai');

    config.stt = { provider: sttProvider };

    if (sttProvider === 'openai') {
      // Reuse OpenAI API key if already set
      if (config.llm.openai?.api_key) {
        const reuse = await askYesNo('Reuse your OpenAI API key for STT?', true);
        if (reuse) {
          config.stt.openai = { api_key: config.llm.openai.api_key };
        } else {
          const key = await askSecret('OpenAI API key for STT');
          if (key) config.stt.openai = { api_key: key };
        }
      } else {
        const key = await askSecret('OpenAI API key for Whisper STT');
        if (key) config.stt.openai = { api_key: key };
      }
    } else if (sttProvider === 'groq') {
      const key = await askSecret('Groq API key (from console.groq.com)');
      if (key) config.stt.groq = { api_key: key };
    } else if (sttProvider === 'local') {
      const endpoint = await ask('Local Whisper endpoint', 'http://localhost:8080');
      config.stt.local = { endpoint };
    }
  } else {
    printInfo('Skipped. Voice input will be disabled.');
  }

  // ── Step 6: Channels ──────────────────────────────────────────────

  printStep(6, TOTAL_STEPS, 'Communication Channels');
  console.log('  JARVIS can receive messages from Telegram and Discord.\n');

  const setupChannels = await askYesNo('Configure messaging channels?', false);
  if (setupChannels) {
    // Telegram
    const setupTG = await askYesNo('Set up Telegram?', false);
    if (setupTG) {
      const token = await askSecret('Telegram bot token (from @BotFather)');
      if (token) {
        const userId = await ask('Your Telegram user ID (numeric)');
        config.channels = config.channels ?? {};
        config.channels.telegram = {
          enabled: true,
          bot_token: token,
          allowed_users: userId ? [parseInt(userId, 10)] : [],
        };
        printOk('Telegram configured.');
      }
    }

    // Discord
    const setupDC = await askYesNo('Set up Discord?', false);
    if (setupDC) {
      const token = await askSecret('Discord bot token (from discord.dev)');
      if (token) {
        const userId = await ask('Your Discord user ID');
        config.channels = config.channels ?? {};
        config.channels.discord = {
          enabled: true,
          bot_token: token,
          allowed_users: userId ? [userId] : [],
        };
        printOk('Discord configured.');
      }
    }
  } else {
    printInfo('Skipped. Configure channels later for remote access.');
  }

  // ── Step 7: Personality ───────────────────────────────────────────

  printStep(7, TOTAL_STEPS, 'Personality');
  console.log('  Customize JARVIS\'s personality traits.\n');

  const customPersonality = await askYesNo('Customize personality traits?', false);
  if (customPersonality) {
    console.log(c.dim('  Current traits: ' + config.personality.core_traits.join(', ')));
    const traitsInput = await ask(
      'Enter traits (comma-separated)',
      config.personality.core_traits.join(', ')
    );
    config.personality.core_traits = traitsInput.split(',').map(t => t.trim()).filter(Boolean);
    printOk(`Traits: ${config.personality.core_traits.join(', ')}`);
  } else {
    printInfo(`Using defaults: ${config.personality.core_traits.join(', ')}`);
  }

  // ── Step 8: Authority Level ───────────────────────────────────────

  printStep(8, TOTAL_STEPS, 'Authority & Safety');
  console.log('  Controls what JARVIS can do autonomously.\n');
  console.log(c.dim('  Level 1-3: Conservative (read-only, ask for everything)'));
  console.log(c.dim('  Level 4-6: Moderate (browse, read/write files, run safe commands)'));
  console.log(c.dim('  Level 7-10: Aggressive (full autonomy, sends emails, manages apps)'));
  console.log('');

  const customAuth = await askYesNo('Customize authority settings?', false);
  if (customAuth) {
    const levelStr = await ask('Default authority level (1-10)', String(config.authority.default_level));
    const level = parseInt(levelStr, 10);
    if (level >= 1 && level <= 10) {
      config.authority.default_level = level;
    }

    // Governed categories
    console.log(c.dim('\n  Governed categories require your approval before executing:'));
    console.log(c.dim('  Current: ' + config.authority.governed_categories.join(', ')));
    printInfo('Keeping default governed categories (send_email, send_message, make_payment)');
  } else {
    printInfo(`Using defaults: level ${config.authority.default_level}, governed: ${config.authority.governed_categories.join(', ')}`);
  }

  // ── Step 9: Daemon Settings ───────────────────────────────────────

  printStep(9, TOTAL_STEPS, 'Daemon Settings');

  const customDaemon = await askYesNo('Customize daemon settings?', false);
  if (customDaemon) {
    const portStr = await ask('Dashboard port', String(config.daemon.port));
    const port = parseInt(portStr, 10);
    if (port > 0 && port < 65536) config.daemon.port = port;
  } else {
    printInfo(`Using defaults: port ${config.daemon.port}, data at ${JARVIS_DIR}`);
  }

  // ── Step 10: Autostart ────────────────────────────────────────────

  printStep(10, TOTAL_STEPS, 'Autostart');
  const platform = detectPlatform();

  if (platform === 'wsl') {
    printInfo('WSL detected. Autostart is not supported in WSL.');
    printInfo('Start JARVIS manually with: jarvis start');
  } else {
    console.log(`  Autostart mechanism: ${c.bold(getAutostartName())}\n`);
    const setupAutostart = await askYesNo('Start JARVIS automatically on login?', false);
    if (setupAutostart) {
      await installAutostart();
    } else {
      printInfo('Skipped. Start manually with: jarvis start');
    }
  }

  // ── Save ──────────────────────────────────────────────────────────

  console.log('\n' + c.bold('─'.repeat(50)));
  console.log(c.bold('\nConfiguration Summary:\n'));

  const summaryItems: [string, string][] = [
    ['LLM Provider', `${config.llm.primary} (${config.llm[config.llm.primary as keyof typeof config.llm] ? 'configured' : 'not set'})`],
    ['Fallback', config.llm.fallback.join(' -> ')],
    ['TTS', config.tts?.enabled ? `${config.tts.voice}` : 'disabled'],
    ['STT', config.stt?.provider ?? 'not configured'],
    ['Telegram', config.channels?.telegram?.enabled ? 'enabled' : 'disabled'],
    ['Discord', config.channels?.discord?.enabled ? 'enabled' : 'disabled'],
    ['Authority', `level ${config.authority.default_level}`],
    ['Port', String(config.daemon.port)],
  ];

  for (const [key, value] of summaryItems) {
    console.log(`  ${c.dim(key.padEnd(16))} ${value}`);
  }

  console.log('');

  const doSave = await askYesNo('Save this configuration?', true);
  if (doSave) {
    await saveConfig(config);
    printOk(`Config saved to ${CONFIG_PATH}`);
  } else {
    printWarn('Configuration not saved.');
  }

  // Offer to start daemon
  console.log('');
  const startNow = await askYesNo('Start JARVIS now?', true);
  if (startNow) {
    console.log(c.cyan('\nStarting J.A.R.V.I.S. daemon...\n'));
    closeRL();

    const { startDaemon } = await import('../daemon/index.ts');
    await startDaemon();
  } else {
    console.log(c.dim('\nStart later with: jarvis start\n'));
    closeRL();
  }
}
