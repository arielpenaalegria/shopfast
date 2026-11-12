'use strict';
/**
 * Verificación de pagos USDT en BSC (BEP20) a partir del hash de la transacción, usando un nodo RPC (NodeReal).
 * Solo LEE la blockchain: el panel nunca tiene la clave privada de la billetera.
 *
 *  USDT_WALLET     tu dirección BEP20 que recibe los pagos (0x...)
 *  BSC_RPC_URL     URL RPC de NodeReal para BSC mainnet (https://bsc-mainnet.nodereal.io/v1/TU_API_KEY)
 *  BSC_MIN_CONFIRMATIONS  confirmaciones mínimas (por defecto 15, unos 45 segundos)
 */
const WALLET = String(process.env.USDT_WALLET || '').trim().toLowerCase();
const RPC = String(process.env.BSC_RPC_URL || '').trim();
const MIN_CONF = Math.max(1, Number(process.env.BSC_MIN_CONFIRMATIONS) || 15);
// Contrato oficial de USDT en BSC (BSC-USD, 18 decimales). Un token falso con el mismo nombre tiene otra dirección.
const USDT = String(process.env.USDT_CONTRACT || '0x55d398326f99059ff775485246999027b3197955').toLowerCase();
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer(address,address,uint256)

const walletOk = /^0x[0-9a-f]{40}$/.test(WALLET);
const enabled = () => walletOk && !!RPC;
const isHash = h => /^0x[0-9a-f]{64}$/.test(h);

async function rpc(method, params) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctrl.signal });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Error RPC');
    return d.result;
  } finally { clearTimeout(t); }
}

/**
 * Revisa una transacción. Devuelve:
 *  { state: 'ok', cents, from, block }          pago válido de USDT a tu billetera, con confirmaciones suficientes
 *  { state: 'wait', msg }                       todavía no está en un bloque o le faltan confirmaciones
 *  { state: 'bad', msg }                        no es un pago válido (otra red, otro token, otra billetera, falló...)
 *  { state: 'error', msg }                      no se pudo consultar el nodo (se reintenta)
 */
async function check(hash) {
  try {
    const rc = await rpc('eth_getTransactionReceipt', [hash]);
    if (!rc) return { state: 'wait', msg: 'La transacción todavía no aparece en BSC (o es de otra red).' };
    if (rc.status !== '0x1') return { state: 'bad', msg: 'La transacción falló en la blockchain.' };
    let total = 0n, from = null;
    for (const l of rc.logs || []) {
      if (String(l.address).toLowerCase() !== USDT || !l.topics || l.topics[0] !== TRANSFER || l.topics.length < 3) continue;
      const to = '0x' + l.topics[2].slice(26).toLowerCase();
      if (to !== WALLET) continue;
      total += BigInt(l.data);
      from = from || '0x' + l.topics[1].slice(26).toLowerCase();
    }
    if (!total) return { state: 'bad', msg: 'Esa transacción no envía USDT (BEP20) a la billetera del panel.' };
    const cents = Number(total / 10n ** 16n); // 18 decimales -> centavos (se redondea hacia abajo)
    const block = parseInt(rc.blockNumber, 16), head = parseInt(await rpc('eth_blockNumber', []), 16);
    const conf = head - block + 1;
    if (conf < MIN_CONF) return { state: 'wait', msg: `Esperando confirmaciones (${Math.max(conf, 0)}/${MIN_CONF}).`, cents, from };
    return { state: 'ok', cents, from, block };
  } catch (e) {
    return { state: 'error', msg: 'No se pudo consultar BSC: ' + e.message };
  }
}

module.exports = { enabled, check, isHash, wallet: () => (walletOk ? WALLET : null), minConf: MIN_CONF, walletOk: () => walletOk };
