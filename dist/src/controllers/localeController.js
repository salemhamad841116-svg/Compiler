const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../../public/locales');

/**
 * Controller serving translation dictionaries dynamically.
 */
function getLocaleDictionary(req, res) {
  const lang = (req.params.lang || 'en').toLowerCase().replace(/[^a-z]/g, '');
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: `Locale dictionary not found for language: ${lang}`,
    });
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return res.status(200).json({
      success: true,
      lang,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: `Failed to load locale dictionary: ${err.message}`,
    });
  }
}

module.exports = {
  getLocaleDictionary,
};
