import { DefaultResourceLoader, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';

async function test() {
  const rl = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    settingsManager: SettingsManager.create(process.cwd(), getAgentDir()),
  });
  await rl.reload();
  const exts = rl.getExtensions();
  console.log('Extensions loaded:', exts.extensions.length);
  console.log('Extension errors:', exts.errors.length);
  if (exts.extensions.length > 0) {
    console.log('First ext tools:', exts.extensions[0].tools?.map(t => t.name));
  }
  const sp = rl.getSystemPrompt();
  console.log('System prompt length:', sp?.length || 0);
}
test().catch(e => console.error(e));
