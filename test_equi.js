const { Client } = require('node-rfc');
require('dotenv').config();

(async () => {
  const c = new Client({ 
    ashost: 's4h2023.sapdemo.com', 
    sysnr: '25', client: '100', 
    user: 's23hana7', 
    passwd: process.env.SERVICE_PASSWORD, 
    lang: 'EN' 
  });
  await c.open();
  
  const tables = ['EQUI', 'EQKT', 'EQUZ', 'ILOA'];
  for (const t of tables) {
    try {
      const res = await c.call('RFC_READ_TABLE', { 
        QUERY_TABLE: t, 
        DELIMITER: '|', 
        FIELDS: [{FIELDNAME: t === 'ILOA' ? 'ILOAN' : 'EQUNR'}] 
      });
      console.log(`${t} Success: ${res.DATA.length}`);
    } catch (e) {
      console.log(`${t} Error: ${e.message}`);
    }
  }
  await c.close();
})();
