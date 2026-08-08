import { createWorkflow } from './workflow.js';

const samples = [
  'Köpeğime 4 saat bakıcı lazım, $40',
  'Bugün saat 1-5 arası boşum para kazanmak istiyorum',
  'Cuma gününe kadar $430 lazım',
  'Evlenmek istiyorum, bana uygun biriyle eşleştir'
];

for (const [i, text] of samples.entries()) {
  console.log(JSON.stringify(createWorkflow({ id: `demo-${i + 1}`, user_id: 'demo-user', text }), null, 2));
}
