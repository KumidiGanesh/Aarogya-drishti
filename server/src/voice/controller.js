const speech = require('../adapters/speech');

async function speechToText(req, res, next) {
  try {
    const data = await speech.speechToText(
      req.file,
      req.validated.body.language,
      req.validated.body.duration_seconds,
    );
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, message: 'Speech recognized', data, meta: {} });
  } catch (error) {
    next(error);
  }
}

async function textToSpeech(req, res, next) {
  try {
    const { text, language } = req.validated.body;
    const result = await speech.textToSpeech(text, language);
    if (result.fallback) {
      res.set('Cache-Control', 'private, max-age=300');
      return res.status(200).json({
        success: true,
        message: 'Use browser speech synthesis',
        data: {
          fallback: true,
          voice_language: result.voice_language,
          hint: result.hint,
          cache_key: result.cache_key,
        },
        meta: {},
      });
    }
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="speech.mp3"',
      'Cache-Control': 'private, max-age=3600',
      ETag: `"${result.cache_key}"`,
    });
    if (req.get('if-none-match') === `"${result.cache_key}"`) return res.status(304).end();
    return res.status(200).send(result.audio);
  } catch (error) {
    return next(error);
  }
}

module.exports = { speechToText, textToSpeech };
