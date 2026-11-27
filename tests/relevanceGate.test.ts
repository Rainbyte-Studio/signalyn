/**
 * Unit Test Suite for Strategic Relevance Gate (Phase 4C.1)
 * 
 * Verifies:
 * 1. HUAWEI smartphone -> IN_SCOPE
 * 2. Apple/Samsung smartphone -> IN_SCOPE
 * 3. Smartwatch -> IN_SCOPE
 * 4. Earbuds / Audio -> IN_SCOPE
 * 5. Tablet -> IN_SCOPE
 * 6. Automotive -> OUT_OF_SCOPE
 * 7. Gaming / Game Studio -> OUT_OF_SCOPE
 * 8. Desktop GPU / PC Components -> OUT_OF_SCOPE
 * 9. Unrelated AI Story -> OUT_OF_SCOPE
 * 10. Ambiguous Generic Product Name -> UNCERTAIN
 * 11. Greek Strategic Terminology -> correct classification
 * 12. Generic marketing tokens (Air, Pro, Ultra, Pad) don't falsely classify
 */

import { classifyStrategicRelevance } from '../src/server/strategicRelevanceGate';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
  }
}

export function runRelevanceGateTests() {
  console.log('=== STARTING STRATEGIC RELEVANCE GATE TESTS ===\n');

  // Test 1: HUAWEI Smartphone
  console.log('--- Test 1: HUAWEI Smartphone ---');
  {
    const res1 = classifyStrategicRelevance({
      title: 'Huawei Mate XT trifold smartphone goes on sale globally with dual-folding display',
      excerpt: 'Huawei unveils its latest mobile flagship with advanced Kirin chipset.',
    });
    assert(res1.decision === 'IN_SCOPE', '1A: Huawei Mate XT is IN_SCOPE');
    assert(res1.category === 'SMARTPHONE', '1B: Category is SMARTPHONE');
    assert(res1.matchedCompanies.includes('HUAWEI'), '1C: Matched HUAWEI');

    const res2 = classifyStrategicRelevance({
      title: 'Huawei Pura 70 Ultra camera benchmark tests show variable aperture dominance',
      excerpt: 'Detailed review of the Pura 70 smartphone camera capabilities.',
    });
    assert(res2.decision === 'IN_SCOPE', '1D: Huawei Pura 70 is IN_SCOPE');
    assert(res2.category === 'SMARTPHONE', '1E: Category is SMARTPHONE');
  }

  // Test 2: Apple / Samsung Smartphone
  console.log('\n--- Test 2: Apple / Samsung Smartphone ---');
  {
    const resApple = classifyStrategicRelevance({
      title: 'Apple iPhone 16 Pro teardown reveals improved thermal design and A18 Pro chip',
      excerpt: 'The new iPhone smartphone features a larger periscope zoom lens.',
    });
    assert(resApple.decision === 'IN_SCOPE', '2A: iPhone 16 Pro is IN_SCOPE');
    assert(resApple.category === 'SMARTPHONE', '2B: Apple device categorized as SMARTPHONE');

    const resSamsung = classifyStrategicRelevance({
      title: 'Samsung Galaxy S25 Ultra leaks point to rounded corners and Snapdragon 8 Elite',
      excerpt: 'Samsung prepares its next generation flagship phone for early 2025 release.',
    });
    assert(resSamsung.decision === 'IN_SCOPE', '2C: Galaxy S25 Ultra is IN_SCOPE');
    assert(resSamsung.category === 'SMARTPHONE', '2D: Samsung Galaxy S25 is SMARTPHONE');
  }

  // Test 3: Smartwatch / Wearable
  console.log('\n--- Test 3: Smartwatch / Wearable ---');
  {
    const resWatch = classifyStrategicRelevance({
      title: 'Huawei Watch GT 5 Pro launched in Europe with 14-day battery life and titanium body',
      excerpt: 'Huawei refreshes its flagship smartwatch series with new TruSense health tracking.',
    });
    assert(resWatch.decision === 'IN_SCOPE', '3A: Watch GT 5 Pro is IN_SCOPE');
    assert(resWatch.category === 'WEARABLE', '3B: Categorized as WEARABLE');

    const resGarmin = classifyStrategicRelevance({
      title: 'Garmin Fenix 8 smartwatch brings AMOLED display and dive rating',
      excerpt: 'A multisport GPS wearable designed for extreme athletes.',
    });
    assert(resGarmin.decision === 'IN_SCOPE', '3C: Garmin Fenix 8 is IN_SCOPE');
    assert(resGarmin.category === 'WEARABLE', '3D: Garmin is WEARABLE');
  }

  // Test 4: Earbuds / Audio
  console.log('\n--- Test 4: Earbuds / Audio ---');
  {
    const resAudio = classifyStrategicRelevance({
      title: 'Huawei FreeBuds Pro 3 review: stellar active noise cancellation and sound quality',
      excerpt: 'These true wireless earbuds offer LDAC codec support and crystal clear calls.',
    });
    assert(resAudio.decision === 'IN_SCOPE', '4A: FreeBuds Pro 3 is IN_SCOPE');
    assert(resAudio.category === 'AUDIO', '4B: Categorized as AUDIO');

    const resAirPods = classifyStrategicRelevance({
      title: 'Apple AirPods 4 announced with ANC options and USB-C case',
      excerpt: 'The new wireless earbuds feature improved acoustic architecture.',
    });
    assert(resAirPods.decision === 'IN_SCOPE', '4C: AirPods 4 is IN_SCOPE');
    assert(resAirPods.category === 'AUDIO', '4D: AirPods categorized as AUDIO');
  }

  // Test 5: Tablet
  console.log('\n--- Test 5: Tablet ---');
  {
    const resTab = classifyStrategicRelevance({
      title: 'Huawei MatePad Pro 12.2 launched with dual-layer OLED PaperMatte display',
      excerpt: 'The new productivity tablet supports the NearLink M-Pencil stylus.',
    });
    assert(resTab.decision === 'IN_SCOPE', '5A: MatePad Pro is IN_SCOPE');
    assert(resTab.category === 'TABLET', '5B: Categorized as TABLET');

    const resIPad = classifyStrategicRelevance({
      title: 'Apple iPad Pro M4 review: impossibly thin slate with breakthrough OLED screen',
      excerpt: 'Apple’s top-tier tablet reaches new heights with tandem OLED.',
    });
    assert(resIPad.decision === 'IN_SCOPE', '5C: iPad Pro is IN_SCOPE');
    assert(resIPad.category === 'TABLET', '5D: iPad categorized as TABLET');
  }

  // Test 6: Automotive -> OUT_OF_SCOPE
  console.log('\n--- Test 6: Automotive ---');
  {
    const resAuto1 = classifyStrategicRelevance({
      title: 'Volkswagen unveils new electric ID.7 sedan with extended range and fast EV charging',
      excerpt: 'German automaker expands its electric vehicle fleet with competitive pricing.',
    });
    assert(resAuto1.decision === 'OUT_OF_SCOPE', '6A: Volkswagen EV is OUT_OF_SCOPE');
    assert(resAuto1.category === 'OTHER', '6B: Non-strategic category is OTHER');

    const resAuto2 = classifyStrategicRelevance({
      title: 'Tesla starts full self-driving robotaxi trials in California',
      excerpt: 'Autopilot safety updates and hardware sensors discussed by Elon Musk.',
    });
    assert(resAuto2.decision === 'OUT_OF_SCOPE', '6C: Tesla robotaxi is OUT_OF_SCOPE');
  }

  // Test 7: Gaming / Game Studio -> OUT_OF_SCOPE
  console.log('\n--- Test 7: Gaming / Game Studio ---');
  {
    const resGame = classifyStrategicRelevance({
      title: 'Sony announces PlayStation 5 Pro pricing and enhanced GPU specs for upcoming games',
      excerpt: 'The gaming console aims for 60fps 4K performance across first-party titles.',
    });
    assert(resGame.decision === 'OUT_OF_SCOPE', '7A: PS5 Pro gaming console is OUT_OF_SCOPE');

    const resStudio = classifyStrategicRelevance({
      title: 'Ember Lab reveals new trailer and gameplay for fantasy RPG on Steam',
      excerpt: 'The indie video game developer discusses boss fights and graphics improvements.',
    });
    assert(resStudio.decision === 'OUT_OF_SCOPE', '7B: Game studio RPG is OUT_OF_SCOPE');
  }

  // Test 8: Desktop GPU / PC Components -> OUT_OF_SCOPE
  console.log('\n--- Test 8: Desktop GPU / PC Components ---');
  {
    const resGPU = classifyStrategicRelevance({
      title: 'NVIDIA GeForce RTX 5090 desktop graphics card leaked with massive power draw',
      excerpt: 'New Blackwell architecture desktop GPU requires PCIe 5 power connectors.',
    });
    assert(resGPU.decision === 'OUT_OF_SCOPE', '8A: Desktop GeForce RTX is OUT_OF_SCOPE');

    const resPC = classifyStrategicRelevance({
      title: 'Intel Arrow Lake Core Ultra desktop CPUs launch with new AM5-competing motherboard socket',
      excerpt: 'Testing DDR5 memory overclocking and liquid cooling efficiency on desktop test bench.',
    });
    assert(resPC.decision === 'OUT_OF_SCOPE', '8B: Desktop CPU and motherboard is OUT_OF_SCOPE');
  }

  // Test 9: Unrelated AI Story -> OUT_OF_SCOPE
  console.log('\n--- Test 9: Unrelated AI Story ---');
  {
    const resAI = classifyStrategicRelevance({
      title: 'OpenAI faces new copyright lawsuit over large language model training data',
      excerpt: 'Enterprise legal battle over web scraping and intellectual property for generative AI.',
    });
    assert(resAI.decision === 'OUT_OF_SCOPE', '9A: OpenAI copyright lawsuit is OUT_OF_SCOPE');

    const resCloud = classifyStrategicRelevance({
      title: 'AWS and Azure invest billions in new nuclear-powered AI data center infrastructure',
      excerpt: 'Cloud computing demand drives massive expansion of server clusters.',
    });
    assert(resCloud.decision === 'OUT_OF_SCOPE', '9B: Cloud AI data center is OUT_OF_SCOPE');
  }

  // Test 10: Ambiguous Generic Product Name -> UNCERTAIN
  console.log('\n--- Test 10: Ambiguous Generic Product Name ---');
  {
    const resAmbiguous = classifyStrategicRelevance({
      title: 'Huawei patents mysterious new Ultra Pro device concept in China',
      excerpt: 'Patent filings show novel industrial design but no mention of specific mobile form factor.',
    });
    assert(resAmbiguous.decision === 'UNCERTAIN', '10A: Huawei patent with no category is UNCERTAIN (preserved)');
    assert(resAmbiguous.category === 'UNKNOWN', '10B: Category is UNKNOWN');

    const resGoogle = classifyStrategicRelevance({
      title: 'Google partners with retail consortium on enterprise digital identity',
      excerpt: 'Security alliance announced at European digital summit.',
    });
    assert(resGoogle.decision === 'UNCERTAIN' || resGoogle.decision === 'OUT_OF_SCOPE', '10C: Google enterprise news safely handled');
  }

  // Test 11: Greek Strategic Terminology
  console.log('\n--- Test 11: Greek Strategic Terminology ---');
  {
    const resGreekPhone = classifyStrategicRelevance({
      title: 'Το νέο αναδιπλούμενο smartphone της Huawei κυκλοφορεί στην Ελλάδα',
      excerpt: 'Διαθέσιμο στα ελληνικά καταστήματα το κορυφαίο κινητό τηλέφωνο με HarmonyOS.',
    });
    assert(resGreekPhone.decision === 'IN_SCOPE', '11A: Greek foldable smartphone is IN_SCOPE');
    assert(resGreekPhone.category === 'SMARTPHONE', '11B: Greek smartphone category recognized');

    const resGreekWatch = classifyStrategicRelevance({
      title: 'Huawei Watch GT 5: Το νέο έξυπνο ρολόι με αυτονομία δύο εβδομάδων',
      excerpt: 'Επίσημη παρουσίαση στην Αθήνα για το νέο smartwatch με προηγμένους αισθητήρες υγείας.',
    });
    assert(resGreekWatch.decision === 'IN_SCOPE', '11C: Greek smartwatch is IN_SCOPE');
    assert(resGreekWatch.category === 'WEARABLE', '11D: Greek smartwatch category recognized');

    const resGreekAudio = classifyStrategicRelevance({
      title: 'Δοκιμάζουμε τα νέα ασύρματα ακουστικά με ενεργή ακύρωση θορύβου',
      excerpt: 'Εντυπωσιακή ποιότητα ήχου και άνετη εφαρμογή στα νέα TWS ακουστικά.',
    });
    assert(resGreekAudio.decision === 'IN_SCOPE', '11E: Greek wireless earbuds is IN_SCOPE');
    assert(resGreekAudio.category === 'AUDIO', '11F: Greek audio category recognized');

    const resGreekAuto = classifyStrategicRelevance({
      title: 'Η Volkswagen παρουσίασε το νέο ηλεκτρικό αυτοκίνητο για την ελληνική αγορά',
      excerpt: 'Δοκιμή οδήγησης για το νέο SUV με μεγάλη αυτονομία.',
    });
    assert(resGreekAuto.decision === 'OUT_OF_SCOPE', '11G: Greek automotive news is OUT_OF_SCOPE');
  }

  // Test 12: Generic Token Safeguards (Air, Pro, Ultra, Pad)
  console.log('\n--- Test 12: Generic Token Safeguards ---');
  {
    const resAir = classifyStrategicRelevance({
      title: 'New cooling fan brings cooler air to home offices',
      excerpt: 'A portable desktop fan tested during summer heatwaves.',
    });
    assert(resAir.decision === 'OUT_OF_SCOPE', '12A: "Air" alone does not trigger audio or tablet');

    const resPad = classifyStrategicRelevance({
      title: 'Ergonomic mouse pad and wrist rest reviewed for office workers',
      excerpt: 'Comfortable accessories for desktop computer ergonomics.',
    });
    assert(resPad.decision === 'OUT_OF_SCOPE', '12B: "Pad" alone does not trigger tablet');
  }

  // Test 13: Garmin Official Competitor Resolution
  console.log('\n--- Test 13: Garmin Official Competitor ---');
  {
    const resGarmin = classifyStrategicRelevance({
      title: 'Garmin Instinct 3 rugged smartwatch announced with solar charging',
      excerpt: 'Garmin expands outdoor sports lineup with improved endurance.',
    });
    assert(resGarmin.decision === 'IN_SCOPE', '13A: Garmin Instinct 3 is IN_SCOPE');
    assert(resGarmin.category === 'WEARABLE', '13B: Garmin classified as WEARABLE');
    assert(resGarmin.matchedCompanies.includes('Garmin'), '13C: Matched Garmin company');
  }

  // Test 14: Calibrated SMARTPHONE & UNCERTAIN Edge Cases
  console.log('\n--- Test 14: Calibrated SMARTPHONE & UNCERTAIN Edge Cases ---');
  {
    const resVivo = classifyStrategicRelevance({
      title: 'Αυτή είναι η τιμή του Vivo X Fold 6',
      excerpt: 'Το νέο αναδιπλούμενο smartphone έρχεται στην ευρωπαϊκή αγορά.',
    });
    assert(resVivo.decision === 'IN_SCOPE', '14A: Vivo X Fold 6 is IN_SCOPE');
    assert(resVivo.category === 'SMARTPHONE', '14B: Vivo X Fold 6 is SMARTPHONE');

    const resS27 = classifyStrategicRelevance({
      title: 'Galaxy S27 Ultra: Η Samsung χτυπά ξανά με νέα κάμερα 200MP',
      excerpt: 'Διαρροές αποκαλύπτουν τα σχέδια της Samsung για τη σειρά Galaxy S27.',
    });
    assert(resS27.decision === 'IN_SCOPE', '14C: Galaxy S27 Ultra is IN_SCOPE');
    assert(resS27.category === 'SMARTPHONE', '14D: Galaxy S27 Ultra is SMARTPHONE');

    const resFitbit = classifyStrategicRelevance({
      title: 'Google launches Fitbit Air in India with advanced heart tracking',
      excerpt: 'The new wearable fitness band offers sleep monitoring and stress tracking.',
    });
    assert(resFitbit.decision === 'IN_SCOPE', '14E: Fitbit Air with wearable context is IN_SCOPE');
    assert(resFitbit.category === 'WEARABLE', '14F: Fitbit Air is WEARABLE');

    const resHWW6 = classifyStrategicRelevance({
      title: 'Huawei Watch 6: Πρακτική πολυτέλεια και αυτονομία χωρίς συμβιβασμούς',
      excerpt: 'Δοκιμάζουμε το νέο έξυπνο ρολόι της Huawei.',
    });
    assert(resHWW6.decision === 'IN_SCOPE', '14G: Huawei Watch 6 is IN_SCOPE');
    assert(resHWW6.category === 'WEARABLE', '14H: Huawei Watch 6 is WEARABLE');
  }

  // Test 15: Home Appliances & Laptops Out-of-Scope Protection
  console.log('\n--- Test 15: Home Appliances & Laptops Out-of-Scope Protection ---');
  {
    const resWasher = classifyStrategicRelevance({
      title: 'Xiaomi launches its first heat pump washer-dryer at surprisingly high price',
      excerpt: 'Smart home cleaning appliance introduced in China.',
    });
    assert(resWasher.decision === 'OUT_OF_SCOPE', '15A: Washer-dryer is OUT_OF_SCOPE');

    const resLaptop = classifyStrategicRelevance({
      title: 'The Best Laptops You Can Buy in 2026',
      excerpt: 'Top MacBook and Windows laptops compared for battery life.',
    });
    assert(resLaptop.decision === 'OUT_OF_SCOPE', '15B: Laptop roundup is OUT_OF_SCOPE');

    const resMassager = classifyStrategicRelevance({
      title: 'Xiaomi announces Mijia Smart Waist and Back Massager with dual guide rail',
      excerpt: 'Home health appliance with heat therapy functions.',
    });
    assert(resMassager.decision === 'OUT_OF_SCOPE', '15C: Smart massager is OUT_OF_SCOPE');
  }

  console.log(`\n=== RELEVANCE GATE TESTS FINISHED: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    throw new Error(`${failed} tests failed!`);
  }
}

if (process.argv[1]?.includes('relevanceGate.test.ts')) {
  runRelevanceGateTests();
}
