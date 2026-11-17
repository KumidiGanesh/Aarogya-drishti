const knowledge = [
  {
    id: 'warning-signs',
    keywords: {
      en: ['symptom', 'sign', 'ulcer', 'mouth sore', 'white patch', 'red patch', 'lump', 'bleeding', 'swallow', 'open my mouth', 'pain'],
      te: ['లక్షణ', 'పుండు', 'తెల్లటి మచ్చ', 'తెలుపు మచ్చ', 'ఎర్రటి మచ్చ', 'గడ్డ', 'రక్తం', 'మింగ', 'నోరు తెరవ', 'నొప్పి', 'మచ్చ'],
      hi: ['लक्षण', 'घाव', 'छाला', 'सफेद धब्बा', 'लाल धब्बा', 'गांठ', 'खून', 'निगल', 'मुंह खोल', 'दर्द', 'धब्बा'],
      or: ['ଲକ୍ଷଣ', 'ଘା', 'ଧଳା ଦାଗ', 'ଲାଲ ଦାଗ', 'ଗଣ୍ଠି', 'ରକ୍ତ', 'ଗିଳି', 'ପାଟି ଖୋଲି', 'ଯନ୍ତ୍ରଣା', 'ଦାଗ'],
    },
    answers: {
      en: 'Warning changes can include a mouth sore that does not heal within two weeks, a white or red patch, a lump, ongoing pain or bleeding, or difficulty swallowing or opening the mouth. These signs can have many causes and do not mean cancer by themselves. Please arrange an examination with a qualified doctor or dentist.',
      te: 'రెండు వారాల్లో తగ్గని నోటి పుండు, తెలుపు లేదా ఎరుపు మచ్చ, గడ్డ, కొనసాగుతున్న నొప్పి లేదా రక్తస్రావం, మింగడం లేదా నోరు తెరవడంలో ఇబ్బంది వంటి మార్పులను వైద్యుడు పరిశీలించాలి. ఇవి క్యాన్సర్ అని స్వయంగా నిర్ధారించవు; ఇతర కారణాలు కూడా ఉండవచ్చు. అర్హత కలిగిన వైద్యుడు లేదా దంతవైద్యుడిని కలవండి.',
      hi: 'दो सप्ताह में ठीक न होने वाला मुँह का घाव, सफेद या लाल धब्बा, गांठ, लगातार दर्द या खून आना, निगलने या मुँह खोलने में कठिनाई—इन बदलावों की जाँच योग्य डॉक्टर या दंत चिकित्सक से कराएँ। इनके कई कारण हो सकते हैं; इनसे अकेले कैंसर की पुष्टि नहीं होती।',
      or: 'ଦୁଇ ସପ୍ତାହରେ ଭଲ ନହେଉଥିବା ମୁଖ ଘା, ଧଳା କିମ୍ବା ଲାଲ ଦାଗ, ଗଣ୍ଠି, ଲଗାତାର ଯନ୍ତ୍ରଣା କିମ୍ବା ରକ୍ତସ୍ରାବ, ଗିଳିବା କିମ୍ବା ପାଟି ଖୋଲିବାରେ ଅସୁବିଧା ହେଲେ ଯୋଗ୍ୟ ଡାକ୍ତର କିମ୍ବା ଦନ୍ତ ଡାକ୍ତରଙ୍କୁ ଦେଖାନ୍ତୁ। ଏହାର ଅନେକ କାରଣ ଥାଇପାରେ; ଏଥିରୁ ଏକାକୀ କର୍କଟ ନିଶ୍ଚିତ ହୁଏନାହିଁ।',
    },
  },
  {
    id: 'risk-factors',
    keywords: {
      en: ['risk', 'tobacco', 'gutkha', 'smoking', 'smoke', 'areca', 'betel', 'supari', 'alcohol'],
      te: ['ప్రమాదం', 'పొగాకు', 'గుట్కా', 'ధూమపానం', 'వక్క', 'మద్యం'],
      hi: ['जोखिम', 'तंबाकू', 'गुटखा', 'धूम्रपान', 'सुपारी', 'शराब'],
      or: ['ବିପଦ', 'ତମାଖୁ', 'ଗୁଟଖା', 'ଧୂମପାନ', 'ଗୁଆ', 'ମଦ୍ୟ'],
    },
    answers: {
      en: 'Chewing or smoking tobacco, gutkha, areca nut or betel-quid products, and alcohol use can increase the risk of oral disease, including oral cancer. Avoiding these products is an important protective step. A health worker or doctor can help with stopping tobacco.',
      te: 'పొగాకు నమలడం లేదా పొగ త్రాగడం, గుట్కా, వక్క/పాన్ ఉత్పత్తులు మరియు మద్యం నోటి వ్యాధుల ప్రమాదాన్ని, నోటి క్యాన్సర్ సహా, పెంచవచ్చు. వీటిని మానడం ఆరోగ్యానికి ముఖ్యమైన రక్షణ చర్య. పొగాకు మానేందుకు ఆరోగ్య కార్యకర్త లేదా వైద్యుడి సహాయం తీసుకోండి.',
      hi: 'तंबाकू चबाना या धूम्रपान करना, गुटखा, सुपारी/पान उत्पाद और शराब का उपयोग मुँह की बीमारियों, जिनमें मुँह का कैंसर भी शामिल है, का जोखिम बढ़ा सकते हैं। इनसे बचना एक महत्वपूर्ण बचाव कदम है। तंबाकू छोड़ने में स्वास्थ्यकर्मी या डॉक्टर मदद कर सकते हैं।',
      or: 'ତମାଖୁ ଚୋବାଇବା କିମ୍ବା ଧୂମପାନ, ଗୁଟଖା, ଗୁଆ/ପାନ ଉତ୍ପାଦ ଏବଂ ମଦ୍ୟପାନ ମୁଖ ରୋଗର ବିପଦ, ମୁଖ କର୍କଟ ସହିତ, ବଢ଼ାଇପାରେ। ଏଗୁଡ଼ିକୁ ଏଡ଼ାଇବା ଏକ ଜରୁରୀ ସୁରକ୍ଷା ପଦକ୍ଷେପ। ତମାଖୁ ଛାଡ଼ିବା ପାଇଁ ସ୍ୱାସ୍ଥ୍ୟ କର୍ମୀ କିମ୍ବା ଡାକ୍ତରଙ୍କ ସହାୟତା ନିଅନ୍ତୁ।',
    },
  },
  {
    id: 'prevention',
    keywords: {
      en: ['prevent', 'prevention', 'avoid', 'protect', 'oral hygiene', 'brush', 'checkup', 'check-up'],
      te: ['నివారణ', 'నివారించ', 'మానండి', 'పళ్లను తోమ', 'నోటి శుభ్రత', 'పరీక్ష'],
      hi: ['बचाव', 'रोकथाम', 'बचें', 'ब्रश', 'सफाई', 'जाँच'],
      or: ['ପ୍ରତିରୋଧ', 'ବଞ୍ଚିବା', 'ଏଡ଼ାନ୍ତୁ', 'ଦାନ୍ତ ଘଷ', 'ସଫା', 'ଯାଞ୍ଚ'],
    },
    answers: {
      en: 'Avoid tobacco, gutkha and areca-nut products; avoid smoking; keep your mouth clean; and have regular dental or health checkups. Ask a qualified health professional about any change that persists. These steps lower risks but cannot guarantee prevention.',
      te: 'పొగాకు, గుట్కా, వక్క ఉత్పత్తులు మరియు ధూమపానాన్ని మానండి; నోరు శుభ్రంగా ఉంచండి; క్రమం తప్పకుండా దంత లేదా ఆరోగ్య పరీక్షలు చేయించుకోండి. తగ్గకుండా ఉండే మార్పుల గురించి అర్హత కలిగిన ఆరోగ్య నిపుణుడిని అడగండి. ఈ చర్యలు ప్రమాదాన్ని తగ్గిస్తాయి, కానీ పూర్తిగా నివారిస్తాయని హామీ ఇవ్వవు.',
      hi: 'तंबाकू, गुटखा, सुपारी वाले उत्पाद और धूम्रपान से बचें; मुँह साफ रखें; और नियमित दंत या स्वास्थ्य जाँच कराएँ। जो बदलाव ठीक न हो, उसके बारे में योग्य स्वास्थ्यकर्मी से पूछें। ये कदम जोखिम घटाते हैं, पर पूरी रोकथाम की गारंटी नहीं देते।',
      or: 'ତମାଖୁ, ଗୁଟଖା, ଗୁଆ ଉତ୍ପାଦ ଏବଂ ଧୂମପାନ ଏଡ଼ାନ୍ତୁ; ପାଟି ସଫା ରଖନ୍ତୁ; ଏବଂ ନିୟମିତ ଦନ୍ତ କିମ୍ବା ସ୍ୱାସ୍ଥ୍ୟ ଯାଞ୍ଚ କରାନ୍ତୁ। ଦୀର୍ଘ ସମୟ ରହୁଥିବା ପରିବର୍ତ୍ତନ ବିଷୟରେ ଯୋଗ୍ୟ ସ୍ୱାସ୍ଥ୍ୟକର୍ମୀଙ୍କୁ ପଚାରନ୍ତୁ। ଏହି ପଦକ୍ଷେପ ବିପଦ କମାଏ, କିନ୍ତୁ ପୂରାପୂରି ରୋକିବାର ଗ୍ୟାରେଣ୍ଟି ନୁହେଁ।',
    },
  },
  {
    id: 'examination',
    keywords: {
      en: ['biopsy', 'examination', 'exam', 'doctor', 'dentist', 'specialist', 'referral', 'clinic', 'hospital', 'where should i go'],
      te: ['బయాప్సీ', 'పరీక్ష', 'వైద్యుడు', 'దంతవైద్యుడు', 'నిపుణుడు', 'ఎక్కడికి', 'ఆసుపత్రి'],
      hi: ['बायोप्सी', 'जाँच', 'डॉक्टर', 'दंत चिकित्सक', 'विशेषज्ञ', 'कहाँ जाएँ', 'अस्पताल'],
      or: ['ବାୟୋପ୍ସି', 'ପରୀକ୍ଷା', 'ଡାକ୍ତର', 'ଦନ୍ତ ଡାକ୍ତର', 'ବିଶେଷଜ୍ଞ', 'କେଉଁଠି', 'ହସ୍ପିଟାଲ'],
    },
    answers: {
      en: 'A health professional can examine the mouth and decide whether more checks are needed. A biopsy is a small tissue sample examined in a laboratory; only a qualified clinician can interpret it. You can start at your nearest primary health centre, dentist or doctor, who can refer you to a specialist if needed.',
      te: 'ఆరోగ్య నిపుణుడు నోటిని పరిశీలించి మరిన్ని పరీక్షలు అవసరమా నిర్ణయిస్తారు. బయాప్సీ అనేది ప్రయోగశాలలో పరీక్షించే చిన్న కణజాల నమూనా; దాని అర్థాన్ని అర్హత కలిగిన వైద్యుడే చెప్పాలి. సమీప ప్రాథమిక ఆరోగ్య కేంద్రం, దంతవైద్యుడు లేదా వైద్యుడిని ముందుగా సంప్రదించండి; అవసరమైతే వారు నిపుణుడికి పంపిస్తారు.',
      hi: 'स्वास्थ्यकर्मी मुँह की जाँच करके तय कर सकते हैं कि आगे की जाँच चाहिए या नहीं। बायोप्सी में ऊतक का छोटा नमूना लेकर प्रयोगशाला में जाँचा जाता है; इसका अर्थ योग्य डॉक्टर ही बता सकते हैं। पहले नज़दीकी प्राथमिक स्वास्थ्य केंद्र, दंत चिकित्सक या डॉक्टर से मिलें; वे ज़रूरत पड़ने पर विशेषज्ञ के पास भेजेंगे।',
      or: 'ସ୍ୱାସ୍ଥ୍ୟକର୍ମୀ ପାଟି ପରୀକ୍ଷା କରି ଅଧିକ ଯାଞ୍ଚ ଆବଶ୍ୟକ କି ନିଷ୍ପତ୍ତି ନେବେ। ବାୟୋପ୍ସି ହେଉଛି ଟିସୁର ଏକ ଛୋଟ ନମୁନା, ଯାହାକୁ ପରୀକ୍ଷାଗାରରେ ଯାଞ୍ଚ କରାଯାଏ; ଏହାର ଫଳ କେବଳ ଯୋଗ୍ୟ ଡାକ୍ତର ବୁଝାଇପାରିବେ। ନିକଟସ୍ଥ ପ୍ରାଥମିକ ସ୍ୱାସ୍ଥ୍ୟ କେନ୍ଦ୍ର, ଦନ୍ତ ଡାକ୍ତର କିମ୍ବା ଡାକ୍ତରଙ୍କୁ ଦେଖାନ୍ତୁ; ଆବଶ୍ୟକ ହେଲେ ସେମାନେ ବିଶେଷଜ୍ଞଙ୍କୁ ପଠାଇବେ।',
    },
  },
  {
    id: 'introduction',
    keywords: {
      en: ['what is oral cancer', 'oral cancer', 'mouth cancer', 'types of oral cancer', 'early detection'],
      te: ['నోటి క్యాన్సర్ అంటే', 'నోటి క్యాన్సర్', 'ముఖ క్యాన్సర్', 'ప్రారంభ గుర్తింపు'],
      hi: ['मुँह का कैंसर क्या', 'मुंह का कैंसर', 'मुख कैंसर', 'शुरुआती पहचान'],
      or: ['ମୁଖ କର୍କଟ କ’ଣ', 'ମୁଖ କର୍କଟ', 'ମୁହଁ କର୍କଟ', 'ପ୍ରାରମ୍ଭିକ ଚିହ୍ନଟ'],
    },
    answers: {
      en: 'Oral cancer is cancer that starts in the lips or tissues inside the mouth. It can affect different parts of the mouth. Early professional assessment of a persistent change is important, but a chat cannot identify cancer or its cause.',
      te: 'పెదవులు లేదా నోటి లోపలి కణజాలంలో ప్రారంభమయ్యే క్యాన్సర్‌ను నోటి క్యాన్సర్ అంటారు. ఇది నోటిలోని వేర్వేరు భాగాలను ప్రభావితం చేయవచ్చు. తగ్గకుండా ఉండే మార్పును ముందుగానే ఆరోగ్య నిపుణుడు పరిశీలించడం ముఖ్యం; చాట్ ద్వారా క్యాన్సర్‌ను లేదా దాని కారణాన్ని గుర్తించలేం.',
      hi: 'मुँह के होंठों या अंदर के ऊतकों में शुरू होने वाले कैंसर को मुँह का कैंसर कहते हैं। यह मुँह के अलग-अलग हिस्सों को प्रभावित कर सकता है। लगातार रहने वाले बदलाव की समय पर जाँच महत्त्वपूर्ण है, लेकिन चैट कैंसर या उसका कारण नहीं बता सकती।',
      or: 'ଓଠ କିମ୍ବା ପାଟି ଭିତରର ଟିସୁରେ ଆରମ୍ଭ ହେଉଥିବା କର୍କଟକୁ ମୁଖ କର୍କଟ କୁହାଯାଏ। ଏହା ପାଟିର ବିଭିନ୍ନ ଅଂଶକୁ ପ୍ରଭାବିତ କରିପାରେ। ଲଗାତାର ରହୁଥିବା ପରିବର୍ତ୍ତନର ଶୀଘ୍ର ପରୀକ୍ଷା ଜରୁରୀ, କିନ୍ତୁ ଚାଟ୍ କର୍କଟ କିମ୍ବା ଏହାର କାରଣ ଚିହ୍ନଟ କରିପାରେ ନାହିଁ।',
    },
  },
];

const unknownAnswers = {
  en: 'I could not find a reliable answer in the offline oral-health guide. Please connect to the internet or ask a qualified health professional. This assistant cannot diagnose or prescribe.',
  te: 'ఆఫ్‌లైన్ నోటి ఆరోగ్య మార్గదర్శిలో నమ్మదగిన సమాధానం దొరకలేదు. ఇంటర్నెట్‌కు కనెక్ట్ అవ్వండి లేదా అర్హత కలిగిన ఆరోగ్య నిపుణుడిని అడగండి. ఈ సహాయకుడు రోగ నిర్ధారణ లేదా మందుల సూచన చేయడు.',
  hi: 'ऑफ़लाइन मुँह-स्वास्थ्य मार्गदर्शिका में भरोसेमंद उत्तर नहीं मिला। इंटरनेट से जुड़ें या योग्य स्वास्थ्यकर्मी से पूछें। यह सहायक रोग का निदान या दवा नहीं बताता।',
  or: 'ଅଫଲାଇନ୍ ମୁଖ ସ୍ୱାସ୍ଥ୍ୟ ଗାଇଡ୍‌ରେ ଭରସାଯୋଗ୍ୟ ଉତ୍ତର ମିଳିଲା ନାହିଁ। ଇଣ୍ଟରନେଟ୍‌ରେ ଯୋଡ଼ନ୍ତୁ କିମ୍ବା ଯୋଗ୍ୟ ସ୍ୱାସ୍ଥ୍ୟକର୍ମୀଙ୍କୁ ପଚାରନ୍ତୁ। ଏହି ସହାୟକ ରୋଗ ନିର୍ଣ୍ଣୟ କିମ୍ବା ଔଷଧ ଦିଏ ନାହିଁ।',
};

const urgentKeywords = {
  en: ['cannot breathe', 'cannot breath', 'trouble breathing', 'difficulty breathing', 'heavy bleeding', 'bleeding heavily'],
  te: ['శ్వాస తీసుకోలే', 'ఊపిరి ఆడ', 'తీవ్ర రక్తస్రావం'],
  hi: ['सांस नहीं', 'साँस नहीं', 'सांस लेने में कठिनाई', 'भारी रक्तस्राव'],
  or: ['ନିଶ୍ୱାସ ନେଇପାରୁ', 'ଶ୍ୱାସ ନେବାରେ ଅସୁବିଧା', 'ଅଧିକ ରକ୍ତସ୍ରାବ'],
};

const urgentAnswers = {
  en: 'Severe breathing difficulty or heavy bleeding needs urgent in-person care. Contact local emergency services or go to the nearest emergency department now. This chat cannot assess an emergency.',
  te: 'తీవ్ర శ్వాస ఇబ్బంది లేదా ఎక్కువ రక్తస్రావం ఉంటే వెంటనే ప్రత్యక్ష వైద్య సహాయం అవసరం. స్థానిక అత్యవసర సేవలను సంప్రదించండి లేదా సమీప అత్యవసర విభాగానికి వెళ్లండి. ఈ చాట్ అత్యవసర పరిస్థితిని అంచనా వేయలేడు.',
  hi: 'सांस लेने में गंभीर कठिनाई या बहुत अधिक खून बहना तत्काल चिकित्सा सहायता की स्थिति है। स्थानीय आपातकालीन सेवा से संपर्क करें या नज़दीकी आपातकालीन विभाग जाएँ। यह चैट आपात स्थिति का आकलन नहीं कर सकती।',
  or: 'ଗୁରୁତର ଶ୍ୱାସକଷ୍ଟ କିମ୍ବା ଅଧିକ ରକ୍ତସ୍ରାବ ହେଲେ ତୁରନ୍ତ ସାମ୍ନାସାମ୍ନି ଚିକିତ୍ସା ଆବଶ୍ୟକ। ସ୍ଥାନୀୟ ଜରୁରୀକାଳୀନ ସେବା ସହ ଯୋଗାଯୋଗ କରନ୍ତୁ କିମ୍ବା ନିକଟସ୍ଥ ଜରୁରୀକାଳୀନ ବିଭାଗକୁ ଯାଆନ୍ତୁ। ଏହି ଚାଟ୍ ଜରୁରୀ ପରିସ୍ଥିତି ଯାଞ୍ଚ କରିପାରେ ନାହିଁ।',
};

export function getOfflineAnswer(question, language = 'en') {
  const lang = ['en', 'te', 'hi', 'or'].includes(language) ? language : 'en';
  const normalized = question.normalize('NFKC').toLocaleLowerCase();
  if (urgentKeywords[lang].some((keyword) => normalized.includes(keyword))) {
    return urgentAnswers[lang];
  }
  const matched = knowledge
    .map((item) => ({
      item,
      score: item.keywords[lang].filter((keyword) => normalized.includes(keyword)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0];
  return matched ? matched.item.answers[lang] : unknownAnswers[lang];
}

export { unknownAnswers };
