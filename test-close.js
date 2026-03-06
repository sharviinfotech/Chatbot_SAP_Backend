require("dotenv").config();
const { Client } = require("node-rfc");

const connParams = {
  ashost: "49.207.9.62",
  sysnr: "25",
  client: "100",
  user: "developer",
  passwd: process.env.SERVICE_PASSWORD,
  lang: "EN"
};

async function test() {
  const rfcClient = new Client(connParams);
  try {
    await rfcClient.open();
    console.log("Opened! alive:", rfcClient.alive);
    
    // Attempt an RFC call
    try {
      await rfcClient.call("RFC_READ_TABLE", { QUERY_TABLE: "LFA1", ROWCOUNT: 2 });
      console.log("Call 1 OK");
    } catch(e) {
      console.error("Call 1 error:", e.message);
    }
    
    console.log("Before close alive:", rfcClient.alive);
    await rfcClient.close();
    console.log("Closed once! alive:", rfcClient.alive);
    
  } catch(e) {
    console.error("Error:", e.message);
  }
}
test();
