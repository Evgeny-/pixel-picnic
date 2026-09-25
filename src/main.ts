import '@fontsource-variable/nunito';
import './ui/base.css';
import './ui/ui.css';
import { App } from './app/App';

new App().init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 0 0 0;padding:12px;background:#fff;color:#c00;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`);
});
