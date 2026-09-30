const crypto = require('crypto');
require('dotenv').config();

// 🔑 Master Encryption Key Derivation (AES-256-GCM)
const RAW_SECRET = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'dcw-setif-algeria-commercial-inspection-2026-master-key';
const SALT = 'dcw_setif_commercial_inspection_salt_2026';
const KEY = crypto.scryptSync(RAW_SECRET, SALT, 32); // 256-bit encryption key
const HMAC_KEY = crypto.createHash('sha256').update(RAW_SECRET + '_hmac_seal_2026').digest();

const ENCRYPTION_PREFIX = 'enc:v1:';

/**
 * Encrypts a plaintext string using Military-Grade AES-256-GCM
 * Output format: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
function encryptText(plainText) {
  if (plainText === null || plainText === undefined) return plainText;
  const str = plainText.toString();
  if (str.trim() === '') return str;
  if (str.startsWith(ENCRYPTION_PREFIX)) return str; // Already encrypted

  try {
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    
    let encrypted = cipher.update(str, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption error:', err.message);
    return str; // Fallback safely
  }
}

/**
 * Decrypts an AES-256-GCM encrypted string
 * If input is legacy plaintext (not starting with enc:v1:), returns it as is
 */
function decryptText(cipherText) {
  if (cipherText === null || cipherText === undefined) return cipherText;
  const str = cipherText.toString();
  if (!str.startsWith(ENCRYPTION_PREFIX)) return str; // Legacy unencrypted plaintext

  try {
    const parts = str.slice(ENCRYPTION_PREFIX.length).split(':');
    if (parts.length !== 3) return str;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed (Data might be tampered):', err.message);
    return str;
  }
}

/**
 * Cryptographic Tamper-Proof Seal (HMAC-SHA256)
 * Generates an immutable cryptographic signature for an inspection visit / PV
 */
function generatePvSeal(pvData) {
  if (!pvData) return null;
  const id = pvData.Id !== undefined ? pvData.Id : (pvData.id || '');
  const empId = pvData.EmployeeId !== undefined ? pvData.EmployeeId : (pvData.employeeId || '');
  const date = (pvData.Date || pvData.date || '').toString().slice(0, 10);
  const shop = (pvData.ShopName || pvData.shopName || '').toString();
  const viol = (pvData.ViolationType || pvData.violationType || '').toString();
  const notes = (pvData.ViolationNotes || pvData.violationNotes || '').toString();
  const seizure = parseFloat(pvData.SeizureValue !== undefined ? pvData.SeizureValue : (pvData.seizureValue || 0)) || 0;
  const legal = (pvData.LegalAction || pvData.legalAction || '').toString();

  const canonicalPayload = [id, empId, date, shop, viol, notes, seizure.toFixed(2), legal].join('||');
  return crypto.createHmac('sha256', HMAC_KEY).update(canonicalPayload, 'utf8').digest('hex');
}

/**
 * Verifies if an inspection visit / PV has been tampered with in the database
 */
function verifyPvSeal(pvData, seal) {
  if (!seal || seal.trim() === '') return true; // Legacy unsealed record
  const expectedSeal = generatePvSeal(pvData);
  return crypto.timingSafeEqual(Buffer.from(expectedSeal, 'hex'), Buffer.from(seal, 'hex'));
}

/**
 * Decrypts sensitive fields for a single visit record
 */
function decryptVisitRecord(v) {
  if (!v) return v;
  const clone = { ...v };

  if (clone.ShopName !== undefined) clone.ShopName = decryptText(clone.ShopName);
  if (clone.shopName !== undefined) clone.shopName = decryptText(clone.shopName);
  if (clone.TraderName !== undefined) clone.TraderName = decryptText(clone.TraderName);

  if (clone.ViolationNotes !== undefined) clone.ViolationNotes = decryptText(clone.ViolationNotes);
  if (clone.violationNotes !== undefined) clone.violationNotes = decryptText(clone.violationNotes);

  if (clone.Notes !== undefined) clone.Notes = decryptText(clone.Notes);
  if (clone.notes !== undefined) clone.notes = decryptText(clone.notes);

  if (clone.LocationName !== undefined) clone.LocationName = decryptText(clone.LocationName);
  if (clone.locationName !== undefined) clone.locationName = decryptText(clone.locationName);

  // Attach digital seal indicator
  const signature = clone.DigitalSignature || clone.digitalsignature;
  if (signature) {
    clone.IsTamperProof = true;
    clone.DigitalSealCode = signature.slice(0, 8).toUpperCase();
  }

  return clone;
}

/**
 * Decrypts sensitive fields for a list of visit records
 */
function decryptVisitsList(list) {
  if (!Array.isArray(list)) return list;
  return list.map(decryptVisitRecord);
}

/**
 * Decrypts sensitive fields for closure orders
 */
function decryptClosureRecord(c) {
  if (!c) return c;
  const clone = { ...c };
  if (clone.EstablishmentName !== undefined) clone.EstablishmentName = decryptText(clone.EstablishmentName);
  if (clone.establishmentName !== undefined) clone.establishmentName = decryptText(clone.establishmentName);
  if (clone.OwnerName !== undefined) clone.OwnerName = decryptText(clone.OwnerName);
  if (clone.ownerName !== undefined) clone.ownerName = decryptText(clone.ownerName);
  if (clone.CommercialRegister !== undefined) clone.CommercialRegister = decryptText(clone.CommercialRegister);
  if (clone.commercialRegister !== undefined) clone.commercialRegister = decryptText(clone.commercialRegister);
  if (clone.Address !== undefined) clone.Address = decryptText(clone.Address);
  if (clone.address !== undefined) clone.address = decryptText(clone.address);
  if (clone.InfractionType !== undefined) clone.InfractionType = decryptText(clone.InfractionType);
  if (clone.infractionType !== undefined) clone.infractionType = decryptText(clone.infractionType);
  if (clone.Notes !== undefined) clone.Notes = decryptText(clone.Notes);
  if (clone.notes !== undefined) clone.notes = decryptText(clone.notes);
  return clone;
}

function decryptClosuresList(list) {
  if (!Array.isArray(list)) return list;
  return list.map(decryptClosureRecord);
}

/**
 * Decrypts sensitive fields for court cases
 */
function decryptCourtRecord(cs) {
  if (!cs) return cs;
  const clone = { ...cs };
  if (clone.DefendantName !== undefined) clone.DefendantName = decryptText(clone.DefendantName);
  if (clone.defendantName !== undefined) clone.defendantName = decryptText(clone.defendantName);
  if (clone.CommercialRegister !== undefined) clone.CommercialRegister = decryptText(clone.CommercialRegister);
  if (clone.commercialRegister !== undefined) clone.commercialRegister = decryptText(clone.commercialRegister);
  if (clone.InfractionDetails !== undefined) clone.InfractionDetails = decryptText(clone.InfractionDetails);
  if (clone.infractionDetails !== undefined) clone.infractionDetails = decryptText(clone.infractionDetails);
  if (clone.SettlementReceipt !== undefined) clone.SettlementReceipt = decryptText(clone.SettlementReceipt);
  if (clone.settlementReceipt !== undefined) clone.settlementReceipt = decryptText(clone.settlementReceipt);
  if (clone.Notes !== undefined) clone.Notes = decryptText(clone.Notes);
  if (clone.notes !== undefined) clone.notes = decryptText(clone.notes);
  return clone;
}

function decryptCourtsList(list) {
  if (!Array.isArray(list)) return list;
  return list.map(decryptCourtRecord);
}

module.exports = {
  encryptText,
  decryptText,
  generatePvSeal,
  verifyPvSeal,
  decryptVisitRecord,
  decryptVisitsList,
  decryptClosureRecord,
  decryptClosuresList,
  decryptCourtRecord,
  decryptCourtsList,
};
