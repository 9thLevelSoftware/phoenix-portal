-- =============================================================
-- Seed exercise_catalog from bundled exercise_dump data
-- Generated from supabase/seed-data/batch_*.sql so clean DB applies
-- have catalog rows before the backfill migration runs.
-- =============================================================

INSERT INTO exercise_catalog (id, name, display_name, description, muscle_group, muscle_groups, muscles, equipment, movement, sidedness, grip, grip_width, default_cable_config, min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom, user_id) VALUES
('4kmhj9yyZcBI54Vi','100s','100s',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000499632,'{}',NULL,FALSE,FALSE,NULL),
('aJS5lGH6jjwC_Zga','Active Copenhagen Plank','Active Copenhagen Plank',NULL,'CORE','{"CORE","LEGS"}','{"abductors","obliques"}','{"BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000214128,'{}',NULL,FALSE,FALSE,NULL),
('yDtqz11KA7nK4FHi','Alternating Bench Press','Alternating Bench Press',NULL,'CHEST','{"CHEST"}','{}','{"BENCH","HANDLES"}','chest_press',NULL,NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,TRUE,FALSE,NULL),
('nDUCrDOuYn1VJAyD','Alternating Bent Over Row','Alternating Bent Over Row',NULL,'ARMS','{"ARMS","BACK"}','{"lats","upper_back"}','{"HANDLES"}','row',NULL,'neutral',NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,TRUE,FALSE,NULL),
('cT86LPCEm_5l2-Y2','Alternating Bicep Curls','Alternating Bicep Curls',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl',NULL,NULL,NULL,'DOUBLE',NULL,0.000316094,'{}',NULL,TRUE,FALSE,NULL),
('A7GbtHsBjyZu3Jyv','Alternating Crossover Punch','Alternating Crossover Punch',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','alternating','neutral',NULL,'DOUBLE',NULL,0.002018924,'{}',NULL,FALSE,FALSE,NULL),
('opo1QzcHfFKMx1hI','Alternating Curtsy Lunge','Alternating Curtsy Lunge (Handles)',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","hamstrings","quads"}','{"HANDLES"}','unilateral_leg','alternating','neutral',NULL,'DOUBLE',NULL,0.000989069,'{}',NULL,FALSE,FALSE,NULL),
('A6dPtSIx7AYijn8s','Alternating Curtsy Lunge','Alternating Curtsy Lunge (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"HANDLES"}','unilateral_leg','alternating','neutral',NULL,'DOUBLE',NULL,0.001050248,'{}',NULL,FALSE,FALSE,NULL),
('YS6W8OXgd2jLCljr','Alternating Deficit Lunges','Alternating Deficit Lunges',NULL,'LEGS','{"LEGS"}','{"quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,FALSE,FALSE,NULL),
('ZZEybJ7j3YmjLy_o','Alternating Front Rack Curtsy Lunge','Alternating Front Rack Curtsy Lunge',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","quads"}','{"HANDLES"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000071376,'{}',NULL,FALSE,FALSE,NULL),
('XfkITKH5emJFlGv7','Alternating Hammer Curl','Alternating Hammer Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl',NULL,NULL,NULL,'DOUBLE',NULL,0.000163145,'{}',NULL,TRUE,FALSE,NULL),
('rCG6HJi50F2REZCw','Alternating Lunges','Alternating Lunges (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}','unilateral_leg','alternating',NULL,NULL,'DOUBLE',NULL,0.002508361,'{}',NULL,FALSE,FALSE,NULL),
('9ZDED7N8ni7NDsVj','Alternating Lunges','Alternating Lunges (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BELT"}','unilateral_leg','alternating',NULL,NULL,'DOUBLE',NULL,0.001723223,'{}',NULL,FALSE,FALSE,NULL),
('RWfoqIUvfHyOgg_-','Alternating Oblique Punch','Alternating Oblique Punch',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"HANDLES"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000989069,'{"Alternating Oblique Sit Up"}',NULL,FALSE,FALSE,NULL),
('GPxqQoLkxj_Vcqbe','Alternating Plank Dips','Alternating Plank Dips',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000132555,'{}',NULL,FALSE,FALSE,NULL),
('Qkm5D3V0z13e7LGT','Alternating Renegade Row','Alternating Renegade Row',NULL,'ARMS','{"ARMS","BACK","CORE"}','{"biceps","core","upper_back"}','{"HANDLES"}','row','alternating',NULL,NULL,'DOUBLE',NULL,0.001325556,'{}',NULL,FALSE,FALSE,NULL),
('hVN8gR7bdeRE3uzn','Alternating Reverse Lunge','Alternating Reverse Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('bPCXvQV5baCujiNS','Alternating Side Lunge','Alternating Side Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{}','unilateral_leg','alternating',NULL,NULL,'DOUBLE',NULL,0.000122359,'{}',NULL,FALSE,FALSE,NULL),
('o7_WM7zxaulEavqh','Alternating Suitcase Curtsy Lunge','Alternating Suitcase Curtsy Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}','unilateral_leg','alternating',NULL,NULL,'DOUBLE',NULL,0.00080553,'{}',NULL,FALSE,FALSE,NULL),
('S_MwKyRVHgu57rOk','Alternating Suitcase Deficit Lunge','Alternating Suitcase Deficit Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}','unilateral_leg','alternating',NULL,NULL,'DOUBLE',NULL,0.003793131,'{}',NULL,FALSE,FALSE,NULL),
('D7IHBdqkHR5z2wFn','Arms Crossed Front Squat','Arms Crossed Front Squat',NULL,'BACK','{"BACK","LEGS"}','{"abductors","calves","glutes","hamstrings","lats","lower_back","quads","upper_back"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000550615,'{}',NULL,FALSE,FALSE,NULL),
('3cd0a0cb-8e56-4b0e-83a0-d88ff369749f','Arnold Press','Arnold Press',NULL,'ARMS','{"ARMS","SHOULDERS"}','{"shoulders","triceps"}','{"HANDLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.006903091,'{}',NULL,FALSE,FALSE,NULL),
('5df6aa2a-69a8-4ec7-94b0-ec626044209c','Arnold Press (Out & Up)','Arnold Press (Out & Up)',NULL,'ARMS','{"ARMS","SHOULDERS"}','{"triceps"}','{"HANDLES"}','shoulder_press',NULL,NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,TRUE,FALSE,NULL),
('NlAi6WA8guFWhVpS','Assisted Inchworm','Assisted Inchworm',NULL,'LEGS','{"LEGS","SHOULDERS"}','{"hamstrings","shoulders"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('BLOOMD_TqbF8WyzE','B Stance Bar Rotation','B Stance Bar Rotation',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000428256,'{}',NULL,FALSE,FALSE,NULL),
('YZyOPnvr5kxvP1Fz','Balance Press','Balance Press (Handles)',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","shoulders"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000479239,'{}',NULL,FALSE,FALSE,NULL),
('fqanIzGS6FgTxqbk','Balance Press','Balance Press (Handles)',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","shoulders"}','{"HANDLES"}','shoulder_press','unilateral','neutral',NULL,'DOUBLE',NULL,0.000713761,'{}',NULL,FALSE,FALSE,NULL),
('zL2v6W-mPds9HvRy','Bar Rotation','Bar Rotation',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","shoulders"}','{"BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000316094,'{}',NULL,FALSE,FALSE,NULL),
('8_lUmqQpm5jQhEvA','Bat Crusher','Bat Crusher',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH","ROPE"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.001835386,'{}',NULL,FALSE,FALSE,NULL),
('1vS7ZNfrz2qF6KId','Bayesian Curl','Bayesian Curl (Handles)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}',NULL,'bilateral','supinated',NULL,'DOUBLE',NULL,0.002345215,'{}',NULL,FALSE,FALSE,NULL),
('QzWldJ1xdgra87Z1','Bayesian Curl','Bayesian Curl (Handles)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}',NULL,'unilateral','supinated',NULL,'DOUBLE',NULL,0.000938086,'{"Behind the back curl"}',NULL,FALSE,FALSE,NULL),
('n8MfdJCDxckBGV_4','Bear Crawl','Bear Crawl',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000285504,'{}',NULL,FALSE,FALSE,NULL),
('VEBxiXQ_UMwoycdo','Bear Cross Crunch','Bear Cross Crunch',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,FALSE,FALSE,NULL),
('_AErsqZDhmRWm_rU','Bear Shoulder Tap','Bear Shoulder Tap',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000071376,'{}',NULL,FALSE,FALSE,NULL),
('ZZ92N8QsBdp6HCh3','Bench Press','Bench Press (Bench)','1. Bench: Position the short leg of the bench in the centre of the trainer, in line with the cable inlets.

2. Setup: Lie flat on a bench with your feet firmly planted on the ground. Hold a handle in each hand, positioning them at shoulder level with your palms facing forward.

3. Positioning: Lower the handles under control until they are at chest level. Your elbows should be at around a 50-75 degree angle to your sides.

4. Pressing: Push the handles upward by fully extending your arms.

5. Alignment: As you lift, bring the handles together without letting them touch at the top of the movement.

6. Lowering: Lower the handles back down slowly and under control to your chest.','ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BENCH","HANDLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.034107594,'{}',NULL,FALSE,FALSE,NULL),
('b5d0f3d1-994b-4589-9d2b-b3f36f1412c7','Bench Press','Bench Press (Bar)','1. Bench: Position the short leg of the bench in the centre of the trainer, in line with the cable inlets. Attach the bar and short safety cables.

2. Set up: Lie flat on the bench with your feet firmly planted on the ground. Your head, upper back, and hips should be in contact with the bench.

3. Grip: Grasp the bar with an overhand grip, slightly wider than shoulder-width apart. Your palms should face forward.

4. Positioning: Keep your elbows at around a 50-75 degree angle to your sides.

5. Lift-off: Push the bar upward by fully extending your arms.

6. Lowering: Lower the bar back down slowly and under control until it touches your chest.','ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BAR","BENCH","BLACK_CABLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.049535035,'{}',NULL,FALSE,FALSE,NULL),
('IAcN1MX1kIiF9wdo','Bench Press - Wide Grip','Bench Press - Wide Grip',NULL,'CHEST','{"CHEST"}','{"chest"}','{"BAR","BENCH","BLACK_CABLES"}','chest_press','bilateral','pronated',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('IIEVWF16VLSOCdA2','Bent Over Crossover Neutral Grip Row','Bent Over Crossover Neutral Grip Row',NULL,'BACK','{"BACK"}','{"lats"}','{"HANDLES"}','row','bilateral','neutral',NULL,'DOUBLE',NULL,0.001641651,'{}',NULL,FALSE,FALSE,NULL),
('QPiIhCZA7LwgHjrf','Bent Over Crossover Rear Delt Row','Bent Over Crossover Rear Delt Row',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"HANDLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.001427522,'{}',NULL,FALSE,FALSE,NULL),
('ku9GWXoCLuBShLm0','Bent Over Crossover Row','Bent Over Crossover Row',NULL,'BACK','{"BACK"}','{"upper_back"}','{"HANDLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.002314625,'{}',NULL,FALSE,FALSE,NULL),
('n_dHzWbRx3isCsDt','Bent Over Crossover Upright Row','Bent Over Crossover Upright Row',NULL,'ARMS','{"ARMS","BACK","SHOULDERS"}','{"biceps","traps","upper_back"}','{"HANDLES"}','row',NULL,NULL,NULL,'DOUBLE',NULL,0.00041806,'{}',NULL,TRUE,FALSE,NULL),
('cJt26IdtckFcJsq1','Bent Over Row','Bent Over Row (Rope)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"ROPE"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.003130353,'{}',NULL,FALSE,FALSE,NULL),
('rC0baJJTFuQdbwng','Bent Over Row','Bent Over Row (Short Bar)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"SHORT_BAR"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.002559344,'{}',NULL,FALSE,FALSE,NULL),
('67195cbd-7e2b-4d96-804b-0182b8bf2bab','Bent Over Row','Bent Over Row (Bar)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BAR","BLACK_CABLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.020352394,'{}',NULL,FALSE,FALSE,NULL),
('31ea9d9e-669c-4752-9f44-80c3fa864021','Bent Over Row','Bent Over Row (Handles)','1. Setup: Stand with your feet shoulder-width apart and hold a handle in each hand with palms facing your body.

2. Bending: Hinge at the hips to bend your upper body forward while keeping your back straight. Your chest should be almost parallel to the ground. Let your arms hang down.

3. Positioning: Pull your shoulder blades back and down, engaging your back muscles.

4. Rowing: Bend your elbows and lift the handles toward your sides. Keep your elbows close to your body as you lift.

5. Squeezing: At the top of the movement, squeeze your shoulder blades together to fully engage your back muscles.

6. Lowering: Lower the handles back down to the starting position with control.','BACK','{"BACK"}','{"lats","upper_back"}','{"HANDLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.012898686,'{}',NULL,FALSE,FALSE,NULL),
('cc7f2c3a-20bd-4a3e-8d5a-393420386c23','Bent Over Row - Reverse Grip','Bent Over Row - Reverse Grip (Bar)',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"BAR","BLACK_CABLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.002090301,'{}',NULL,FALSE,FALSE,NULL),
('BRd2HV_4zo1M5V1e','Bent Over Row - Reverse Grip','Bent Over Row - Reverse Grip (Short Bar)',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"SHORT_BAR"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.000530222,'{}',NULL,FALSE,FALSE,NULL),
('aea28a4b-d442-4bba-8c64-1e1780d243dd','Bent Over Row - Reverse Grip','Bent Over Row - Reverse Grip (Handles)',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"HANDLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.001366343,'{}',NULL,FALSE,FALSE,NULL),
('U4yuZdXmjYhMHANs','Bent Over Row - Reverse Grip (SC)','Bent Over Row - Reverse Grip (SC)',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"HANDLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.000142752,'{}',NULL,FALSE,FALSE,NULL),
('useRdaf9DVqyjBD8','Bent Over Row - Wide Grip','Bent Over Row - Wide Grip (Handles)',NULL,'BACK','{"BACK","SHOULDERS"}','{"lats","shoulders","upper_back"}','{"HANDLES"}','row','bilateral','pronated',NULL,'DOUBLE',NULL,0.000173342,'{}',NULL,FALSE,FALSE,NULL),
('2b09f28a-b765-4aab-90ec-8c14318d63eb','Bent Over Row - Wide Grip','Bent Over Row - Wide Grip (Handles)',NULL,'BACK','{"BACK","SHOULDERS"}','{"lats","shoulders","upper_back"}','{"HANDLES"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.00122359,'{}',NULL,FALSE,FALSE,NULL),
('4e3de525-1be3-4b1c-a95c-07e74697f7b4','Bent Over Row - Wide Grip','Bent Over Row - Wide Grip (Bar)',NULL,'BACK','{"BACK"}','{}','{"BAR","BLACK_CABLES"}','row',NULL,NULL,NULL,'DOUBLE',NULL,0.000254914,'{}',NULL,TRUE,FALSE,NULL),
('bMavugVodLEh2ltO','Bent Over Row (SC)','Bent Over Row (SC) (Handles)',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats"}','{"HANDLES"}',NULL,'bilateral','supinated',NULL,'DOUBLE',NULL,0.000499632,'{}',NULL,FALSE,FALSE,NULL),
('2YFK0aiPUOIOlThL','Bent Over Row (SC)','Bent Over Row (SC) (Handles)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"HANDLES"}','row','bilateral','neutral',NULL,'DOUBLE',NULL,0.000713761,'{}',NULL,FALSE,FALSE,NULL),
('dbUz7Op2hhKbax4u','Bent Over Row SA','Bent Over Row SA',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"HANDLES"}','row','bilateral','neutral',NULL,'DOUBLE',NULL,0.001641651,'{}',NULL,FALSE,FALSE,NULL),
('4c78ed02-89bb-4de4-b346-72a268b0d4c0','Bent Over SA Lateral Raise','Bent Over SA Lateral Raise',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','unilateral',NULL,NULL,'DOUBLE',NULL,0.001356146,'{}',NULL,FALSE,FALSE,NULL),
('1VBYUlGszYuK29Rh','Bent Over Shrug','Bent Over Shrug',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps"}','{"BAR","BLACK_CABLES"}','shoulder_isolation','bilateral',NULL,NULL,'DOUBLE',NULL,0.001101231,'{}',NULL,FALSE,FALSE,NULL),
('cc0b27a7-679a-406e-a56e-44778bafaec5','Bent Over Tricep Extension','Bent Over Tricep Extension',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','unilateral','pronated',NULL,'DOUBLE',NULL,0.002916224,'{}',NULL,FALSE,FALSE,NULL),
('k-PGXPztgc5uS42S','Bicep Curl','Bicep Curl (Short Bar)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"SHORT_BAR"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.010257769,'{}',NULL,FALSE,FALSE,NULL),
('b2fb6fcd-3f47-403d-bad1-0f5e3f62d048','Bicep Curl','Bicep Curl (Bar)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BAR","BLACK_CABLES"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.014509747,'{}',NULL,FALSE,FALSE,NULL),
('fc5ca114-3cb6-462a-ab54-7ef1233b5fc2','Bicep Curl','Bicep Curl (Handles)','1. Setup: Stand with your feet shoulder-width apart, holding a handle in each hand with palms facing forward.

2. Starting Position: Keep your back straight, shoulders relaxed, and elbows close to your sides.

3. Curling: Bend your elbows and lift the handles towards your shoulders while keeping your upper arms stationary.

4. Squeezing: At the top of the movement, contract your biceps and pause for a brief moment to squeeze.

5. Lowering: Lower the handles back down to the starting position with control.','ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.030436821,'{}',NULL,FALSE,FALSE,NULL),
('X9EUD_qwbhc2EIQw','Bicep Curl - Pronated','Bicep Curl - Pronated (Short Bar)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"SHORT_BAR"}','bicep_curl','bilateral','pronated',NULL,'DOUBLE',NULL,0.001937352,'{}',NULL,FALSE,FALSE,NULL),
('NFtfHV_LdJnwXJO8','Bicep Curl - Pronated','Bicep Curl - Pronated (Handles)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','bilateral','pronated',NULL,'DOUBLE',NULL,0.002477771,'{"Overhand Bicep Curl"}',NULL,FALSE,FALSE,NULL),
('lird71_6aqwu88tw','Bicep Curl - Pronated','Bicep Curl - Pronated (Bar)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BAR","BLACK_CABLES"}','bicep_curl','bilateral','pronated',NULL,'DOUBLE',NULL,0.003262908,'{"Reverse Grip Bicep Curl"}',NULL,FALSE,FALSE,NULL),
('6EIQ-UEuPz3uuRqk','Bicep Curl (SC)','Bicep Curl (SC)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.000734154,'{}',NULL,FALSE,FALSE,NULL),
('ui8LejWIv-bX3USV','Bicycle Crunch','Bicycle Crunch',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000377273,'{}',NULL,FALSE,FALSE,NULL),
('oFP4aOA23Uo82gRD','Bird Dog','Bird Dog',NULL,'BACK','{"BACK","CORE"}','{"core","lower_back","upper_back"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000346684,'{}',NULL,FALSE,FALSE,NULL),
('sjMAbrtMa0KptZ3y','Bird Dog Row','Bird Dog Row (Handles)',NULL,'BACK','{"BACK","CORE"}','{"core","lower_back","upper_back"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000938086,'{}',NULL,FALSE,FALSE,NULL),
('WOJDY9rvYsG-LsIb','Bird Dog Row','Bird Dog Row (Bench)',NULL,'BACK','{"BACK","CORE"}','{"core","lower_back","upper_back"}','{"BENCH","HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000958479,'{}',NULL,FALSE,FALSE,NULL),
('-YjRuMgOttzv0yZW','Bulgarian Split Squat','Bulgarian Split Squat (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BELT","BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.001070641,'{}',NULL,FALSE,FALSE,NULL),
('2R1uXL45E-ZnUYYx','Bulgarian Split Squat','Bulgarian Split Squat (Bench)',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"BENCH"}','unilateral_leg',NULL,NULL,NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,TRUE,FALSE,NULL),
('ePpAzISZjVFNQfSM','Bulgarian Split Squat','Bulgarian Split Squat (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000122359,'{}',NULL,FALSE,FALSE,NULL),
('7tufZzs2Sq8JFCdw','Bulgarian Split Squat','Bulgarian Split Squat (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","BENCH","GREY_CABLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.001560078,'{}',NULL,FALSE,FALSE,NULL),
('I07dmYTfP17hH2U9','Bulgarian Split Squat Pulse','Bulgarian Split Squat Pulse (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BAR","BENCH","GREY_CABLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,FALSE,FALSE,NULL),
('mG5IivMZ7IORv3Pn','Bulgarian Split Squat Pulse','Bulgarian Split Squat Pulse (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BENCH","HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000224324,'{}',NULL,FALSE,FALSE,NULL),
('YSIasv929EVKowG5','Bulgarian Split Squat SC','Bulgarian Split Squat SC',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"BENCH","HANDLES"}','unilateral_leg','unilateral','neutral',NULL,'DOUBLE',NULL,0.001682437,'{}',NULL,FALSE,FALSE,NULL),
('Gw-7cQme_mS2hA07','Bulgarian Split Squats','Bulgarian Split Squats (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('a255fcc3-af4d-44b1-8f88-8de014b39ed3','Bulgarian Split Squats','Bulgarian Split Squats (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","HANDLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.005832449,'{}',NULL,FALSE,FALSE,NULL),
('OvUIbKIxKWFw5UbY','Burpee','Burpee',NULL,'CHEST','{"CHEST","CORE","LEGS"}','{"calves","chest","core","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000397667,'{}',NULL,FALSE,FALSE,NULL),
('10eb76e6-2aa5-482a-af8f-fc3a57cb0ac9','Burpee Jump Over Machine','Burpee Jump Over Machine',NULL,'CHEST','{"CHEST","CORE","LEGS"}','{"calves","chest","core","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000132555,'{}',NULL,FALSE,FALSE,NULL),
('09e41c35-60b7-433a-9642-de420a727937','Burpee with Push-up','Burpee with Push-up',NULL,'CHEST','{"CHEST","CORE","LEGS"}','{"calves","chest","core","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,FALSE,FALSE,NULL),
('WIWjE2EC_O1VswRp','Butt Kicks','Butt Kicks',NULL,'LEGS','{"LEGS"}','{"hamstrings","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,FALSE,FALSE,NULL),
('b3ba4645-6b3f-4058-b1f4-0d8fc3e49dff','Cable Fly','Cable Fly',NULL,'CHEST','{"CHEST"}','{"chest"}','{"HANDLES"}','fly','bilateral',NULL,NULL,'DOUBLE',NULL,0.00843258,'{}',NULL,FALSE,FALSE,NULL),
('j3Y1MpvaeGPy0o99','Calf Raise','Calf Raise (Short Bar)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002426788,'{}',NULL,FALSE,FALSE,NULL),
('VY_wFggrTF1Mg-PR','Calf Raise','Calf Raise (Bar)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"BAR","BLACK_CABLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000224324,'{}',NULL,FALSE,FALSE,NULL),
('e74RvoLRZs5arglE','Calf Raise','Calf Raise (Bar)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"BAR","GREY_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001407129,'{}',NULL,FALSE,FALSE,NULL),
('SfPmFe9Tm9CVQ9hC','Calf Raise','Calf Raise (Belt)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00170283,'{}',NULL,FALSE,FALSE,NULL),
('957be087-320a-4e24-ac49-daef883cc6f9','Calf Raise','Calf Raise (Bar)','1. Setup: Stand with your feet shoulder-width apart, holding the bar with palms facing your body.

2. Lifting: Slowly rise up onto the balls of your feet, lifting your heels off the ground.  Try and stick to a large range of motion to allow the machine to adapt to you.

3. Squeezing: At the top of the movement, contract your calf muscles and hold for a brief moment to squeeze.

4. Lowering: Lower your heels back down to the ground with control.','LEGS','{"LEGS"}','{"calves"}','{"BAR","BLACK_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000999265,'{}',NULL,FALSE,FALSE,NULL),
('287a9e39-fd0f-426f-bac1-2b121befb397','Calf Raise','Calf Raise (Handles)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.005924218,'{}',NULL,FALSE,FALSE,NULL),
('0YcECfvzxa6W7EdI','Calf Raise (SC)','Calf Raise (SC)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000448649,'{}',NULL,FALSE,FALSE,NULL),
('17ace32b-c83b-454e-9964-e0f0d91730bb','Chest Press - Gym Ball','Chest Press - Gym Ball',NULL,'CHEST','{"CHEST"}','{"chest"}','{"HANDLES"}','chest_press',NULL,NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,TRUE,FALSE,NULL),
('fA7ZFTOKTBLncn6h','Clam Hip Raise','Clam Hip Raise',NULL,'CORE','{"CORE","LEGS"}','{"abductors","core","glutes"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000316094,'{}',NULL,FALSE,FALSE,NULL),
('63dc79af-81cd-4180-afea-e07204d2b0fd','Close Grip Bench Press','Close Grip Bench Press',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BAR","BENCH","BLACK_CABLES"}','chest_press','bilateral','pronated',NULL,'DOUBLE',NULL,0.004619055,'{}',NULL,FALSE,FALSE,NULL),
('WtNID3Z4AN5C4WYc','Close Grip Pronated Bicep Curl','Close Grip Pronated Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BAR","BLACK_CABLES"}','bicep_curl','bilateral','pronated',NULL,'DOUBLE',NULL,0.000122359,'{}',NULL,FALSE,FALSE,NULL),
('VjcXuTvqtCRz25Il','Close Grip Pulldown','Close Grip Pulldown',NULL,'BACK','{"BACK"}','{"lats","traps","upper_back"}','{"BAR"}','row',NULL,'supinated',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('3VaWHQajM7bvFXg-','Close Grip Push Up','Close Grip Push Up (Belt)',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{"Tricep Push Up"}',NULL,FALSE,FALSE,NULL),
('G_RNflCwbcCj5gxN','Close Grip Push Up','Close Grip Push Up',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000081572,'{"Tricep Push Up"}',NULL,FALSE,FALSE,NULL),
('yeRuEcTX7sn2wPiA','Close Grip Supinated Bicep Curl','Close Grip Supinated Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BAR","BLACK_CABLES"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.000265111,'{}',NULL,FALSE,FALSE,NULL),
('reuAZQ6xN3otjnw-','Commandos','Commandos',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,FALSE,FALSE,NULL),
('wgiwmR1yt3QJtiWs','Concentration Curl','Concentration Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','unilateral',NULL,NULL,'DOUBLE',NULL,0.002069907,'{}',NULL,FALSE,FALSE,NULL)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name, muscle_group=EXCLUDED.muscle_group, muscle_groups=EXCLUDED.muscle_groups, muscles=EXCLUDED.muscles, equipment=EXCLUDED.equipment, movement=EXCLUDED.movement, sidedness=EXCLUDED.sidedness, grip=EXCLUDED.grip, grip_width=EXCLUDED.grip_width, popularity=EXCLUDED.popularity, aliases=EXCLUDED.aliases, archived=EXCLUDED.archived, updated_at=NOW();

INSERT INTO exercise_catalog (id, name, display_name, description, muscle_group, muscle_groups, muscles, equipment, movement, sidedness, grip, grip_width, default_cable_config, min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom, user_id) VALUES
('y7Pkp7Xi2hcXTiJH','Concentration Curl Deep Squat','Concentration Curl Deep Squat (Short Bar)',NULL,'ARMS','{"ARMS","LEGS"}','{"biceps","calves","glutes","hamstrings","quads"}','{"SHORT_BAR"}','bicep_curl','bilateral',NULL,NULL,'DOUBLE',NULL,0.000244718,'{}',NULL,FALSE,FALSE,NULL),
('XcGMgLkg47Ax96gj','Concentration Curl Deep Squat','Concentration Curl Deep Squat (Bar)',NULL,'ARMS','{"ARMS","LEGS"}','{"biceps","calves","glutes","hamstrings","quads"}','{"BAR","BLACK_CABLES"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.000101965,'{}',NULL,FALSE,FALSE,NULL),
('e64c7837-52e2-4b97-b771-cf08ab861af1','Conventional Deadlift','Conventional Deadlift','1. Setup: Stand with your feet about hip-width apart, with the bar in front of you. The middle of your feet should line up with the cable inlets.

2. Grip: Bend at your hips and knees to reach down and grasp the bar with both hands. Your hands should be just outside your knees.

3. Positioning: Keep your back straight, chest up, and shoulders back. Engage your core to maintain stability. The bar should be above the middle of your feet.

4. Lifting: Push through your whole foot and stand up, extending your hips and knees simultaneously. The bar should travel in a straight line close to your body as you lift.

5. Squeezing: At the top of the movement, stand tall with your shoulders back and squeeze your glutes to fully extend your hips.

6. Lowering: Lower the bar back down by reversing the movement, pushing your hips back first, and then bending your knees.','BACK','{"BACK","LEGS"}','{"hamstrings","lats","lower_back"}','{"BAR"}','deadlift','bilateral','pronated',NULL,'DOUBLE',NULL,0.025348723,'{}',NULL,FALSE,FALSE,NULL),
('ap50el1J3FSodPME','Copenhagen Plank','Copenhagen Plank',NULL,'CORE','{"CORE","LEGS"}','{"abductors","core"}','{"BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,FALSE,FALSE,NULL),
('E51S5gP_OfDAy_sr','Copenhagen Plank from Knee','Copenhagen Plank from Knee',NULL,'CORE','{"CORE","LEGS"}','{"abductors","obliques"}','{"BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('5G3irxA8agxz7OOq','Copenhagen Plank w Knee Drive','Copenhagen Plank w Knee Drive',NULL,'CORE','{"CORE","LEGS"}','{"abductors","obliques"}','{"BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('b2662fb9-c671-49b8-8dfb-41b4db9b659c','Cossack Squat','Cossack Squat',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000815727,'{}',NULL,FALSE,FALSE,NULL),
('c00f79e4-e8ec-4202-bade-e725df823a54','Crossover Deadlift to Upright Row','Crossover Deadlift to Upright Row',NULL,'BACK','{"BACK","LEGS","SHOULDERS"}','{"glutes","hamstrings","lats","shoulders","traps","upper_back"}','{"HANDLES"}','row','bilateral','pronated',NULL,'DOUBLE',NULL,0.000254914,'{}',NULL,FALSE,FALSE,NULL),
('8976ed4a-43a7-4196-85f3-efdf012f144d','Crossover Lateral Raise','Crossover Lateral Raise (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','bilateral','neutral',NULL,'DOUBLE',NULL,0.00705604,'{}',NULL,FALSE,FALSE,NULL),
('Q0lBY7fh2g35aPP0','Crossover Lateral Raise','Crossover Lateral Raise (Straps)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"STRAPS"}',NULL,'bilateral','neutral',NULL,'DOUBLE',NULL,0.000571009,'{}',NULL,FALSE,FALSE,NULL),
('z70P8xJtRTKpAUbr','Crossover Lateral Raise','Crossover Lateral Raise (Straps)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"STRAPS"}','shoulder_isolation','bilateral','neutral',NULL,'DOUBLE',NULL,0.000469043,'{}',NULL,FALSE,FALSE,NULL),
('8bd88d71-8fd2-4bab-93b8-1508b9e7d711','Crossover Mountain Climber','Crossover Mountain Climber',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000428256,'{}',NULL,FALSE,FALSE,NULL),
('e37b0252-18c5-4953-945e-02e52430e669','Crossover RDL','Crossover RDL',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats"}','{"HANDLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.000581205,'{}',NULL,FALSE,FALSE,NULL),
('20b9cd61-8720-4546-a3c0-8926e3b37559','Crossover Rear Delt Fly','Crossover Rear Delt Fly',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"HANDLES"}',NULL,'bilateral','neutral',NULL,'DOUBLE',NULL,0.003650379,'{}',NULL,FALSE,FALSE,NULL),
('sr674W7IvMJKk_Ft','Crossover Rear Delt Fly (Chest supported)','Crossover Rear Delt Fly (Chest supported)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps","upper_back"}','{"BENCH","HANDLES"}',NULL,'bilateral','neutral',NULL,'DOUBLE',NULL,0.000632188,'{}',NULL,FALSE,FALSE,NULL),
('6685fa0b-d06a-44d3-96b1-372c9e08e6f6','Crossover Rear Delt Row - Single Arm','Crossover Rear Delt Row - Single Arm',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"HANDLES"}','row','unilateral','pronated',NULL,'DOUBLE',NULL,0.000581205,'{}',NULL,FALSE,FALSE,NULL),
('5zzWOT6P_27Lx0ji','Crossover Single Arm Punch','Crossover Single Arm Punch',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000876906,'{}',NULL,FALSE,FALSE,NULL),
('6f2a6d7e-b34d-4875-b57f-1ae3ad61e881','Crossover Sumo Squat','Crossover Sumo Squat',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.001396932,'{}',NULL,FALSE,FALSE,NULL),
('3bb4fb5f-7043-432c-b05c-4c74b25296bc','Crossover Sumo Squat to Upright Row','Crossover Sumo Squat to Upright Row',NULL,'BACK','{"BACK","LEGS","SHOULDERS"}','{"abductors","glutes","hamstrings","quads","shoulders","traps","upper_back"}','{"HANDLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.000662778,'{}',NULL,FALSE,FALSE,NULL),
('5f404b78-63b1-4300-8985-2616c67a6387','Crossover Upright Row','Crossover Upright Row',NULL,'BACK','{"BACK","SHOULDERS"}','{"traps","upper_back"}','{"HANDLES"}','shoulder_press','bilateral','pronated',NULL,'DOUBLE',NULL,0.001101231,'{}',NULL,FALSE,FALSE,NULL),
('FLyfmJWYyxLus7e8','Crunch','Crunch (Handles)',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002222856,'{}',NULL,FALSE,FALSE,NULL),
('66ggji_PJQIsQbS0','Crunch','Crunch (Handles)',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000479239,'{}',NULL,FALSE,FALSE,NULL),
('ee664ea6-c80e-4c4b-a668-972287800fd8','Crunch & Press','Crunch & Press',NULL,'CHEST','{"CHEST","CORE","SHOULDERS"}','{"chest","core","shoulders"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001121624,'{}',NULL,FALSE,FALSE,NULL),
('egUQWULHDoSjtL8V','Crunch Isometric Hold','Crunch Isometric Hold',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"HANDLES"}',NULL,'bilateral','neutral',NULL,'DOUBLE',NULL,0.000183538,'{}',NULL,FALSE,FALSE,NULL),
('868001a3-9f16-46c3-893a-c5dcda8baba9','Curl and Press','Curl and Press',NULL,'ARMS','{"ARMS","SHOULDERS"}','{"biceps","shoulders"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00128477,'{"Curl to Press"}',NULL,FALSE,FALSE,NULL),
('QBSeHJ9M1ZlHgKX2','Curtsy Lunge (Front Rack)','Curtsy Lunge (Front Rack)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"HANDLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000183538,'{}',NULL,TRUE,FALSE,NULL),
('NNxOd-C972Jqef4L','Dead Bug SA Press','Dead Bug SA Press',NULL,'CHEST','{"CHEST","CORE","SHOULDERS"}','{"chest","core","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('1j1WimoER0Y18K3E','Dead Bug SA Press (Staggered)','Dead Bug SA Press (Staggered)',NULL,'ARMS','{"ARMS","CORE"}','{"core","triceps"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000152948,'{}',NULL,FALSE,FALSE,NULL),
('q6DefK78W0OQ7_SO','Deadlift to Row','Deadlift to Row (Short Bar)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","upper_back"}','{"SHORT_BAR"}','row','bilateral','pronated',NULL,'DOUBLE',NULL,0.000091769,'{}',NULL,FALSE,FALSE,NULL),
('d3dac0a9-730d-467f-aae5-1bb94912ad2a','Deadlift to Row','Deadlift to Row (Handles)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","upper_back"}','{"HANDLES"}','row','bilateral','mixed',NULL,'DOUBLE',NULL,0.000723957,'{}',NULL,FALSE,FALSE,NULL),
('e192a7f4-fec2-4a84-9fe2-325807ecc729','Deadlift to Row','Deadlift to Row (Bar)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","upper_back"}','{"BAR"}','row','bilateral',NULL,NULL,'DOUBLE',NULL,0.000407863,'{}',NULL,FALSE,FALSE,NULL),
('Hgy56KiC5KIkfnKa','Decline Bench Press','Decline Bench Press (Bench)',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BENCH","HANDLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.001080838,'{}',NULL,FALSE,FALSE,NULL),
('86CrkMrBHgaM0F37','Decline Bench Press','Decline Bench Press (Bar)',NULL,'CHEST','{"CHEST"}','{"chest"}','{"BAR","BENCH","BLACK_CABLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.001743616,'{}',NULL,FALSE,FALSE,NULL),
('AeiPi6KkNR9qIDh-','Decline Close Grip Bench Press','Decline Close Grip Bench Press',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BAR","BENCH","BLACK_CABLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.000214128,'{}',NULL,FALSE,FALSE,NULL),
('v0NgxXnrmmuzAfnY','Decline Push Up','Decline Push Up',NULL,'ARMS','{"ARMS","CHEST","CORE"}','{"chest","core","triceps"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,FALSE,FALSE,NULL),
('JV4Yi4GmzVk0UGtl','Deficit Lateral Lunge','Deficit Lateral Lunge (Handles)',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","quads"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000734154,'{}',NULL,FALSE,FALSE,NULL),
('oDeHGZQ-nlQOBxmz','Deficit Lateral Lunge','Deficit Lateral Lunge (Short Bar)',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","quads"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000672974,'{}',NULL,FALSE,FALSE,NULL),
('4a6a6919-8f0d-4aaa-bf02-e95ed4dd5c35','Deficit Lunge','Deficit Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BAR","GREY_CABLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.000846316,'{}',NULL,FALSE,FALSE,NULL),
('0UZlcqCFg96PjE8-','Deficit Lunge w/ Knee Drive','Deficit Lunge w/ Knee Drive',NULL,'LEGS','{"LEGS"}','{"quads"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('WSDB1LCOKOsX9YXk','Deficit Reverse Lunge','Deficit Reverse Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.00035688,'{}',NULL,FALSE,FALSE,NULL),
('G0g8AZrQu7f59s1x','Diamond Push up','Diamond Push up',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('hSimW4jxLocg_EKr','Dive Push Up','Dive Push Up',NULL,'CHEST','{"CHEST"}','{"chest"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,FALSE,FALSE,NULL),
('f81ee440-c855-4f3a-b1c8-f9ecf7d094cb','Donkey Kicks','Donkey Kicks (Straps)',NULL,'CORE','{"CORE","LEGS"}','{"core","glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.00310996,'{}',NULL,FALSE,FALSE,NULL),
('4OXK82acFzVXTrZe','Donkey Kicks','Donkey Kicks (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"BENCH","STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.000469043,'{}',NULL,FALSE,FALSE,NULL),
('2eed878d-2012-4afb-ad70-f64f984d5dc2','Double Arm Front Raise','Double Arm Front Raise',NULL,'CHEST','{"CHEST","SHOULDERS"}','{"chest","shoulders"}','{"HANDLES"}','shoulder_isolation','bilateral',NULL,NULL,'DOUBLE',NULL,0.001447915,'{}',NULL,FALSE,FALSE,NULL),
('KFn-lgt-UV6b-yAK','Double Leg Raise','Double Leg Raise',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000142752,'{}',NULL,FALSE,FALSE,NULL),
('6LmWpxKB2deeX7iQ','Double Leg Raise (Bench Supported)','Double Leg Raise (Bench Supported)',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"BENCH"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000591402,'{}',NULL,FALSE,FALSE,NULL),
('l-itz-TCl2e1_uUp','Double Leg Raise (Eccentric)','Double Leg Raise (Eccentric)',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000071376,'{}',NULL,FALSE,FALSE,NULL),
('MUu5o4_srT0c4ptN','Double Leg Raise w/ Reverse Crunch','Double Leg Raise w/ Reverse Crunch',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000142752,'{}',NULL,FALSE,FALSE,NULL),
('nQIaQ-Kp7cM4Oy9s','Double Leg Raise w/ Reverse Crunch (Bench Supported)','Double Leg Raise w/ Reverse Crunch (Bench Supported) (Bench)',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"BENCH"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000203931,'{}',NULL,FALSE,FALSE,NULL),
('vONctzRAV3GZWpTV','Double Leg Raise w/ Reverse Crunch (Bench Supported)','Double Leg Raise w/ Reverse Crunch (Bench Supported) (Bench)',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"BENCH","STRAPS"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000305897,'{}',NULL,FALSE,FALSE,NULL),
('GyiZjtq5QAQy1hzN','Down Dog Calf Stretch','Down Dog Calf Stretch',NULL,'LEGS','{"LEGS"}','{"calves","hamstrings"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('lKxWrGuEzVcxLYqG','Face Pull','Face Pull',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"BENCH","ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001478505,'{}',NULL,FALSE,FALSE,NULL),
('CZp8oeIT32m1oO8o','Face Pulls','Face Pulls',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.005883432,'{}',NULL,FALSE,FALSE,NULL),
('zwaotHCXoNwVjrNT','Feet Raised 1 + 1/2 Glute Bridge','Feet Raised 1 + 1/2 Glute Bridge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}','glute_accessory',NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('1QjQwyZheylDBykH','Feet Raised Glute Bridge','Feet Raised Glute Bridge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('0c131bda-bf01-41b2-97ce-80d1fc83026e','Fire Hydrant','Fire Hydrant',NULL,'CORE','{"CORE","LEGS"}','{"abductors","core","glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.001376539,'{}',NULL,FALSE,FALSE,NULL),
('NGccEsSujysaQIed','Floor Press','Floor Press',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"HANDLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.003507627,'{}',NULL,FALSE,FALSE,NULL),
('9e739d52-b11f-47f7-bd63-1d4d863b4ab1','Floor Press w/ Glute Bridge','Floor Press w/ Glute Bridge',NULL,'ARMS','{"ARMS","CHEST","LEGS"}','{"chest","glutes","hamstrings","triceps"}','{"HANDLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.000672974,'{}',NULL,FALSE,FALSE,NULL),
('Ug8YmwoOxjKOEeNg','Frog Glute Bridge','Frog Glute Bridge',NULL,'LEGS','{"LEGS"}','{"glutes"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('Y6IywI3vUiG9AeZe','Frog Squats (Partial)','Frog Squats (Partial)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,TRUE,FALSE,NULL),
('ODHzWyeiiVF_Q3JZ','Front Rack Alternating Lunge','Front Rack Alternating Lunge (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000173342,'{}',NULL,FALSE,FALSE,NULL),
('X6XG3En5RH8Ka7X9','Front Rack Alternating Lunge','Front Rack Alternating Lunge (Handles)',NULL,'LEGS','{"LEGS"}','{"quads"}','{"HANDLES"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000081572,'{}',NULL,FALSE,FALSE,NULL),
('EPSSOT9ozKJ4BPTy','Front Rack Alternating Lunge','Front Rack Alternating Lunge (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,FALSE,FALSE,NULL),
('xdCN5W3rPbuctEXz','Front Rack Alternating Lunge','Front Rack Alternating Lunge (Bar)',NULL,'General','{}','{}','{"BAR","GREY_CABLES"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('GTFIH_gOYlCCC92S','Front Rack Alternating Lunges','Front Rack Alternating Lunges',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"SHORT_BAR"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('h-O6ehUrYas9zfJd','Front Rack Bulgarian Split Squat','Front Rack Bulgarian Split Squat (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('FeNQJ6wqTbMYEy4l','Front Rack Bulgarian Split Squat','Front Rack Bulgarian Split Squat (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('jNcIFqAdSNjkvkEq','Front Rack Curtsy Lunge','Front Rack Curtsy Lunge',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('KHN9hB2veZtKYSQd','Front Rack Deficit Lunge','Front Rack Deficit Lunge (Short Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('2HvNYbiiSYCLGDLm','Front Rack Deficit Lunge','Front Rack Deficit Lunge (Handles)',NULL,'General','{}','{}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.00125418,'{}',NULL,FALSE,FALSE,NULL),
('ZABoOqaKi1l05B60','Front Rack Deficit Reverse Lunge','Front Rack Deficit Reverse Lunge (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('Oi7sI-t0pWwFlIrd','Front Rack Deficit Reverse Lunge','Front Rack Deficit Reverse Lunge (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000428256,'{}',NULL,FALSE,FALSE,NULL),
('wijHbng_Ko5ZFlHH','Front Rack Lunge','Front Rack Lunge (Short Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000193735,'{}',NULL,FALSE,FALSE,NULL),
('QjQv-c74lSGUDCnE','Front Rack Lunge','Front Rack Lunge (Handles)',NULL,'BACK','{"BACK","LEGS"}','{"calves","glutes","hamstrings","lats","quads","upper_back"}','{"HANDLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,TRUE,FALSE,NULL),
('EP_3kiRUPCsB3Ink','Front Rack Lunge Pulse','Front Rack Lunge Pulse (Short Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('-PfFQ98tPSj0XmKz','Front Rack Lunge Pulse','Front Rack Lunge Pulse (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('16aa93f9-6536-4845-9d36-3bf4f25bd53e','Front Rack Reverse Lunge','Front Rack Reverse Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000152948,'{}',NULL,FALSE,FALSE,NULL),
('5SXkLGb_cZ3y3SEp','Front Rack Side Bend','Front Rack Side Bend',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000652581,'{}',NULL,FALSE,FALSE,NULL),
('a966c177-a0bf-4a73-9213-603e4c7f874f','Front Rack Sit to Stand','Front Rack Sit to Stand (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","BENCH","GREY_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000183538,'{"Box Squat"}',NULL,FALSE,FALSE,NULL),
('aKxQ07JUJupQ228B','Front Rack Sit to Stand','Front Rack Sit to Stand (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{"Box Squat"}',NULL,FALSE,FALSE,NULL),
('g_N-RlzugzHdxrOT','Front Rack Sit to Stand','Front Rack Sit to Stand (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000265111,'{"Box Squat"}',NULL,FALSE,FALSE,NULL),
('c6a055b1-453e-42fa-8e1e-2c7b7337c2a8','Front Rack Squat','Front Rack Squat',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00170283,'{"Front Squat"}',NULL,FALSE,FALSE,NULL),
('5sKS1-9ZFVE84haI','Front Rack Squat Pulses','Front Rack Squat Pulses',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000183538,'{"Quarter Rep Squat"}',NULL,FALSE,FALSE,NULL),
('DIw77aTVcaREePpN','Front Rack Sumo Squat','Front Rack Sumo Squat',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000112162,'{"Front Squat"}',NULL,FALSE,FALSE,NULL),
('DL9vy76nqDUN-C39','Front Raise','Front Raise (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','unilateral','pronated',NULL,'DOUBLE',NULL,0.000489436,'{}',NULL,FALSE,FALSE,NULL),
('XNfzZZ_CO6H06iPp','Front Raise','Front Raise (Rope)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"ROPE"}',NULL,'bilateral','neutral',NULL,'DOUBLE',NULL,0.001070641,'{}',NULL,FALSE,FALSE,NULL),
('d38c603f-42a4-4317-8ab9-9a226f41dac7','Front Raise','Front Raise (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','bilateral','pronated',NULL,'DOUBLE',NULL,0.002977404,'{}',NULL,FALSE,FALSE,NULL),
('YZ82MoaAeOm4rVTL','Front Raise','Front Raise (Short Bar)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"SHORT_BAR"}','shoulder_isolation','bilateral',NULL,NULL,'DOUBLE',NULL,0.001774206,'{}',NULL,FALSE,FALSE,NULL),
('d40ae794-5202-4909-a753-77917bd914d3','Front Raise','Front Raise (Bar)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BAR","BLACK_CABLES"}','shoulder_isolation','bilateral',NULL,NULL,'DOUBLE',NULL,0.001152214,'{}',NULL,FALSE,FALSE,NULL),
('AXtEXWt1CcZaV28W','Front Raise (SC)','Front Raise (SC)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','bilateral',NULL,NULL,'DOUBLE',NULL,0.000978872,'{}',NULL,FALSE,FALSE,NULL),
('rwTxzKiYAl8UENGp','Front Squat','Front Squat (Short Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000397667,'{}',NULL,FALSE,FALSE,NULL),
('cGKByiAR77dtK3lu','Front Squat','Front Squat (Handles)',NULL,'BACK','{"BACK","LEGS"}','{"calves","glutes","hamstrings","lats","lower_back","quads","upper_back"}','{"HANDLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000295701,'{}',NULL,TRUE,FALSE,NULL),
('b254f76e-3109-4db3-bae7-63ea400e63f1','Front Squat','Front Squat (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BAR","GREY_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.003629986,'{}',NULL,FALSE,FALSE,NULL),
('7qYIp48o0GJU5M0M','Fwd Hold SL Hamstring Stretch','Fwd Hold SL Hamstring Stretch',NULL,'General','{}','{}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('eh2ElKDA1-0NYgK1','Glute Bridge','Glute Bridge (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000672974,'{}',NULL,FALSE,FALSE,NULL),
('6fQ73rEu3CXnMdY6','Glute Bridge','Glute Bridge (Short Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001325556,'{}',NULL,FALSE,FALSE,NULL),
('Nt9h8E_VjwMXl0CP','Glute Bridge','Glute Bridge (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00080553,'{}',NULL,FALSE,FALSE,NULL),
('buqjllm5RHJPZySA','Glute Bridge','Glute Bridge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000214128,'{}',NULL,FALSE,FALSE,NULL),
('RZtNggNHiRbBJyO2','Glute Bridge','Glute Bridge (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000163145,'{}',NULL,FALSE,FALSE,NULL)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name, muscle_group=EXCLUDED.muscle_group, muscle_groups=EXCLUDED.muscle_groups, muscles=EXCLUDED.muscles, equipment=EXCLUDED.equipment, movement=EXCLUDED.movement, sidedness=EXCLUDED.sidedness, grip=EXCLUDED.grip, grip_width=EXCLUDED.grip_width, popularity=EXCLUDED.popularity, aliases=EXCLUDED.aliases, archived=EXCLUDED.archived, updated_at=NOW();

INSERT INTO exercise_catalog (id, name, display_name, description, muscle_group, muscle_groups, muscles, equipment, movement, sidedness, grip, grip_width, default_cable_config, min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom, user_id) VALUES
('a63h4_NqIpx-HBY2','Glute Bridge Hold','Glute Bridge Hold',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('W1Uln6rijqNr0JtJ','Glute Bridge Isometric Hold','Glute Bridge Isometric Hold',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}','glute_accessory',NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('e280829c-aa17-4812-b8fa-bcd0d89ad815','Glute Kickbacks','Glute Kickbacks',NULL,'CORE','{"CORE","LEGS"}','{"core","glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.003273105,'{}',NULL,FALSE,FALSE,NULL),
('e5EEv3artsk4BLyj','Goblet Bulgarian Split Squat','Goblet Bulgarian Split Squat',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BENCH","ROPE"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.00032629,'{}',NULL,FALSE,FALSE,NULL),
('M95krGoj6WkwAIgO','Goblet Lunge','Goblet Lunge (Rope)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"ROPE"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000346684,'{}',NULL,FALSE,FALSE,NULL),
('zVTUCilmg4fZPg-N','Goblet Lunge','Goblet Lunge (Rope)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"ROPE"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('2oFMuvdDagw-OcYY','Goblet Reverse Lunge','Goblet Reverse Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"ROPE"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000081572,'{}',NULL,FALSE,FALSE,NULL),
('wmNz4Hk9A8_ls07m','Goblet Squat','Goblet Squat (Rope)',NULL,'CORE','{"CORE","LEGS"}','{"calves","core","glutes","hamstrings","quads"}','{"ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002620523,'{}',NULL,FALSE,FALSE,NULL),
('7g8m11dxjxFtlVaE','Goblet Squat','Goblet Squat (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00080553,'{}',NULL,FALSE,FALSE,NULL),
('8c291e21-6e26-49ff-9e24-048d6868f05d','Goblet Squat','Goblet Squat (Handles)','1. Setup: Facing the cable inlet you are using, stand at a 45 degree angle with your feet slightly wider than shoulder-width apart, holding the handle in both hands vertically close to your chest. Your elbows should be pointing down.

2. Positioning: Keep your chest up, shoulders back, and engage your core for stability.

3. Squatting: Initiate the squat by pushing your hips back and bending your knees. Lower your body down, keeping your back straight and chest lifted.

4. Depth: Descend until your thighs are at least parallel to the ground, or as low as your mobility allows comfortably. Your knees should track in line with your toes.

5. Pause: Hold the bottom position for a brief moment, maintaining tension in your legs and core.

6. Rising: Push through your whole foot and extend your hips and knees simultaneously to return to the starting position. Keep your chest up throughout the movement.','LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002579737,'{}',NULL,FALSE,FALSE,NULL),
('enuJ_FgAzXDLAweK','Good Morning','Good Morning',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","lower_back","upper_back"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('HFrc4ELZxjSKX8PW','Good Morning','Good Morning (Belt)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","lower_back","upper_back"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000397667,'{}',NULL,FALSE,FALSE,NULL),
('466aeaab-97f1-4a25-804e-67a87a9e5e75','Good Morning','Good Morning (Bar)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","lower_back","upper_back"}','{"BAR","GREY_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.003415857,'{}',NULL,FALSE,FALSE,NULL),
('p5QJuQ4Gpc-2sLZz','Gorilla Row','Gorilla Row',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"HANDLES"}','row',NULL,NULL,NULL,'DOUBLE',NULL,0.000132555,'{}',NULL,TRUE,FALSE,NULL),
('SGbLXOqIwiSLAAm2','Half Burpee','Half Burpee',NULL,'CHEST','{"CHEST","CORE","SHOULDERS"}','{"chest","core","shoulders"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000071376,'{}',NULL,FALSE,FALSE,NULL),
('L9ef4EDfoUGYfJBa','Half Kneeling Punch','Half Kneeling Punch',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000163145,'{}',NULL,FALSE,FALSE,NULL),
('00333846-20f5-449a-b836-8568e26d6f43','Half Kneeling SA Low Row','Half Kneeling SA Low Row',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","upper_back"}','{"HANDLES"}','row','unilateral',NULL,NULL,'DOUBLE',NULL,0.001967941,'{}',NULL,FALSE,FALSE,NULL),
('5a7fe3d4-b7f2-4d3f-b92d-4db316c4cd68','Half Kneeling SA Press','Half Kneeling SA Press',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','unilateral',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('CL3J9A1NUUk3Lyez','Half Kneeling SA Rear Delt Row','Half Kneeling SA Rear Delt Row',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"HANDLES"}','row','unilateral',NULL,NULL,'DOUBLE',NULL,0.000489436,'{}',NULL,FALSE,FALSE,NULL),
('5f9e4b5c-4831-4e29-8b75-e0d606f3d97e','Half Kneeling SA Tricep Extension','Half Kneeling SA Tricep Extension',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','unilateral',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('NnBFWmAhKBhucHVk','Half Kneeling Shoulder Press','Half Kneeling Shoulder Press',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BAR"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.000173342,'{}',NULL,FALSE,FALSE,NULL),
('05wiA4Eqtrj388Ui','Hammer Curl','Hammer Curl (Rope)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"ROPE"}','bicep_curl','bilateral','neutral',NULL,'DOUBLE',NULL,0.008748674,'{}',NULL,FALSE,FALSE,NULL),
('77f8d4e5-d97c-43ac-b4fc-d5ff35f67f8d','Hammer Curl','Hammer Curl (Handles)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','bilateral','neutral',NULL,'DOUBLE',NULL,0.00711722,'{}',NULL,FALSE,FALSE,NULL),
('zobadSBT6nfdv3yI','Hammer Curl (SC)','Hammer Curl (SC)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','bilateral','neutral',NULL,'DOUBLE',NULL,0.00032629,'{}',NULL,FALSE,FALSE,NULL),
('kvPr4LgQyeCDjYKP','Hammer Curl SA','Hammer Curl SA',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','unilateral','neutral',NULL,'DOUBLE',NULL,0.000203931,'{}',NULL,FALSE,FALSE,NULL),
('FtvSsh4ZEP6qT2RL','Hamstring Bridge','Hamstring Bridge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BENCH"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('o4uIPacv72Goi9JA','Heel Taps','Heel Taps',NULL,'LEGS','{"LEGS"}','{"abductors"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000101965,'{}',NULL,FALSE,FALSE,NULL),
('MUqWc_cySh8Szk49','High Bar Squat','High Bar Squat',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.013408516,'{"back squat"}',NULL,FALSE,FALSE,NULL),
('9PL2fxrAj07KBsQH','High Crunch','High Crunch',NULL,'CORE','{"CORE"}','{}','{"ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('8XrdZAWCHGX1f6rH','High Knees','High Knees',NULL,'LEGS','{"LEGS"}','{"quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000091769,'{}',NULL,FALSE,FALSE,NULL),
('uG_lnrHRRxh5aVUI','High Knees w/Heel Tap','High Knees w/Heel Tap',NULL,'CORE','{"CORE","LEGS"}','{"abductors","core","quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('HGS1rVxzU-fKxy7U','High Plank & Alternating Row','High Plank & Alternating Row',NULL,'BACK','{"BACK","CORE"}','{"core","lats","obliques","upper_back"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000091769,'{}',NULL,FALSE,FALSE,NULL),
('UIELgL8xBwzqA-B6','High Plank & Row','High Plank & Row',NULL,'BACK','{"BACK","CORE","SHOULDERS"}','{"core","lats","lower_back","shoulders","upper_back"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000224324,'{}',NULL,FALSE,FALSE,NULL),
('ilgPPNsBHESEbB2E','High Plank Down Dog Opp Toe Touch','High Plank Down Dog Opp Toe Touch',NULL,'CORE','{"CORE","LEGS"}','{"calves","core","hamstrings"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,FALSE,FALSE,NULL),
('f38F12ElLyWFqOrp','High Plank to Down Dog','High Plank to Down Dog',NULL,'CORE','{"CORE","LEGS"}','{"calves","core","hamstrings"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('csCzqNi4jTvJwYk1','Hip Extension','Hip Extension',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('ZiydGYd_VS4A2E-m','Hip Flexor Stretch','Hip Flexor Stretch',NULL,'LEGS','{"LEGS"}','{"quads"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('C9PbqbyF98XO4u3h','Hip Flexor Stretch w/ Side Bend','Hip Flexor Stretch w/ Side Bend',NULL,'CORE','{"CORE","LEGS"}','{"obliques","quads"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('4ejxmL2cNgn1D1Iy','Hip Lifts','Hip Lifts',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000071376,'{}',NULL,FALSE,FALSE,NULL),
('T6Vf4-OIurKVfECK','Hip Thrust','Hip Thrust (Belt)','1. Position the short leg of the bench on the ground facing the centre of the trainer (logo side). The tip of the bench should hang over the trainer slightly.

2. Setup: Attach the belt and lay on the bench. Your knees should be bent, and your feet flat on the edge of the trainer, hip-width apart.

3. Bracing: Engage your core and push through your heels to lift your hips off the ground. Your upper back and shoulders should remain in contact with the bench or surface.

4. Thrusting: Drive your hips upward until your body forms a straight line from your shoulders to your knees. Squeeze your glutes at the top of the movement.

5. Lowering: Lower your hips back down in a controlled manner, returning to the starting position.','LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BELT","BENCH"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001957745,'{}',NULL,FALSE,FALSE,NULL),
('o6m-8Vt7VBtb0zNj','Hip Thrust','Hip Thrust (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BENCH","SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000560812,'{}',NULL,FALSE,FALSE,NULL),
('39689096-7fb9-46aa-a411-59c5c6886c5d','Hip Thrust','Hip Thrust (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BAR","BENCH"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002967207,'{}',NULL,FALSE,FALSE,NULL),
('ahjtUdXqry3RTxfC','Hip Thrust - Shoulders Elevated','Hip Thrust - Shoulders Elevated',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}','glute_accessory',NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('ao5pj3MoMoeNZX4i','Hip Thrust (SC)','Hip Thrust (SC)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BENCH","SHORT_BAR"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,TRUE,FALSE,NULL),
('ntLTaE7RsedsHKZV','Hip Thrust Pulses','Hip Thrust Pulses',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"BAR","BENCH"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,FALSE,FALSE,NULL),
('Sn57z0sEiQCQpgfJ','Inchworm','Inchworm',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('aR4mXWcgsqNaxw4C','Incline Bench Press','Incline Bench Press (Bench)',NULL,'ARMS','{"ARMS","CHEST","SHOULDERS"}','{"chest","shoulders","triceps"}','{"BENCH","HANDLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.012970062,'{}',NULL,FALSE,FALSE,NULL),
('99dda2a6-96fa-4d82-970d-58b69425d4db','Incline Bench Press','Incline Bench Press (Bench)',NULL,'ARMS','{"ARMS","CHEST","SHOULDERS"}','{"chest","shoulders","triceps"}','{"BENCH","HANDLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.007841177,'{}',NULL,FALSE,FALSE,NULL),
('IRJrP1HLEvLeAYwt','Incline Bench Press','Incline Bench Press (Bar)',NULL,'ARMS','{"ARMS","CHEST","SHOULDERS"}','{"chest","shoulders","triceps"}','{"BAR","BENCH","BLACK_CABLES"}','chest_press','bilateral','pronated',NULL,'DOUBLE',NULL,0.00744351,'{}',NULL,FALSE,FALSE,NULL),
('8a1690db-cb4f-4e0a-9f66-425e0d5fc3c3','Incline Bench Press','Incline Bench Press (Bar)',NULL,'ARMS','{"ARMS","CHEST","SHOULDERS"}','{"chest","shoulders","triceps"}','{"BAR","BENCH","BLACK_CABLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.002059711,'{}',NULL,FALSE,FALSE,NULL),
('nLSiGdO5Pt5xB2Jl','Incline Fly','Incline Fly',NULL,'CHEST','{"CHEST"}','{"chest"}','{"BENCH","HANDLES"}','fly','bilateral',NULL,NULL,'DOUBLE',NULL,0.010798189,'{}',NULL,FALSE,FALSE,NULL),
('imQqkbnWAkEtJFVN','Incline Pec Fly','Incline Pec Fly',NULL,'CHEST','{"CHEST"}','{}','{"BENCH","HANDLES"}','fly','bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('KUOt38TOSrJUXIFm','Incline Sit to Stand','Incline Sit to Stand (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000122359,'{"Box Squat"}',NULL,FALSE,FALSE,NULL),
('3e6095a6-e21c-4e8e-ae86-c6cd8e4c9f47','Incline Sit to Stand','Incline Sit to Stand (Bench)',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"BENCH","HANDLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('60i5YhMCUmSrvC0E','Jim Clarry''s Face Pulls','Jim Clarry''s Face Pulls',NULL,'BACK','{"BACK","SHOULDERS"}','{}','{"GREY_CABLES","HANDLES"}','shoulder_isolation',NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('1919lq3w9ygAXn5a','Jump Lunges','Jump Lunges',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}','unilateral_leg','alternating',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('WL5DgNRLlWuV4Z1e','Jumping Jacks','Jumping Jacks',NULL,'CORE','{"CORE","LEGS"}','{"calves","core","glutes","hamstrings","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000183538,'{}',NULL,FALSE,FALSE,NULL),
('fAglxv8VMaisUTyo','Just Lift exercise','Just Lift exercise',NULL,'General','{}','{}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.103036544,'{}',NULL,TRUE,FALSE,NULL),
('AROgN8hQF-MJXYGX','Kneeling 45 Degree Kickback','Kneeling 45 Degree Kickback (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"BENCH","STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.000101965,'{}',NULL,FALSE,FALSE,NULL),
('2nTn2QR6MyezFYmK','Kneeling 45 Degree Kickback','Kneeling 45 Degree Kickback',NULL,'LEGS','{"LEGS"}','{"abductors","glutes"}','{}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('6a039e64-c680-407b-b327-f60651f259ad','Kneeling Abduction','Kneeling Abduction',NULL,'CORE','{"CORE","LEGS"}','{"abductors","core","glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.000591402,'{}',NULL,FALSE,FALSE,NULL),
('jczA1loFruC9mHFD','Kneeling Alternating Crossover Punch','Kneeling Alternating Crossover Punch',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"HANDLES"}',NULL,'alternating','neutral',NULL,'DOUBLE',NULL,0.000091769,'{}',NULL,FALSE,FALSE,NULL),
('tfsJJRS6I7cOSo71','Kneeling Kickback','Kneeling Kickback',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"BENCH","STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.000152948,'{}',NULL,FALSE,FALSE,NULL),
('euBpwFXDmK3qak2_','Kneeling Overhead Tricep Extension','Kneeling Overhead Tricep Extension (Short Bar)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"SHORT_BAR"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.001437719,'{}',NULL,FALSE,FALSE,NULL),
('y1ydZQjxjqNn-Fl7','Kneeling Overhead Tricep Extension','Kneeling Overhead Tricep Extension (Handles)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.001050248,'{}',NULL,FALSE,FALSE,NULL),
('kEwXnlEyK-gLtp1J','Kneeling Pull Through','Kneeling Pull Through (Rope)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('qcAqLw_mt6nnAefJ','Kneeling Pull Through','Kneeling Pull Through (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000142752,'{}',NULL,FALSE,FALSE,NULL),
('90f40bd9-7870-4dfd-8a7a-d7114d1e1e4b','Kneeling Row','Kneeling Row',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"BENCH","HANDLES"}','row','unilateral','neutral',NULL,'DOUBLE',NULL,0.016487886,'{"Bench Supported Kneeling SA Row","Single Arm Row"}',NULL,FALSE,FALSE,NULL),
('g8ORRFXiKwPYJSuk','Kneeling Squat','Kneeling Squat',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000244718,'{}',NULL,FALSE,FALSE,NULL),
('7YlYX83qqe_MjJbS','Kneeling Upward Chop','Kneeling Upward Chop (Handles)',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.002284036,'{"kneeling upward twist"}',NULL,FALSE,FALSE,NULL),
('pONqA7dx9ROVRNMN','Kneeling Upward Chop','Kneeling Upward Chop (Bar)',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000112162,'{"Kneeling Upward Twist"}',NULL,FALSE,FALSE,NULL),
('MLcolTxOLfRTxRTu','Kneeling Upward Press','Kneeling Upward Press',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000703564,'{}',NULL,FALSE,FALSE,NULL),
('0QhlDEy6q95TInlZ','Kneeling Upward Twist','Kneeling Upward Twist',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000897299,'{"kneeling upward chop"}',NULL,TRUE,FALSE,NULL),
('OqH0Hh9eHMhJrPmN','Lat Pullover','Lat Pullover (Bar)',NULL,'ARMS','{"ARMS","BACK","CHEST"}','{"chest","lats","triceps"}','{"BAR","BENCH","BLACK_CABLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.002426788,'{}',NULL,FALSE,FALSE,NULL),
('5g98sjn_L1EN7_11','Lat Pullover','Lat Pullover (Rope)',NULL,'ARMS','{"ARMS","BACK","CHEST"}','{"chest","lats","triceps","upper_back"}','{"ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.003140549,'{}',NULL,FALSE,FALSE,NULL),
('kFJrgV343MD0uOZs','Lateral Jumps Over Trainer','Lateral Jumps Over Trainer',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,FALSE,FALSE,NULL),
('8WHxwWifeoVP8vLq','Lateral Raise','Lateral Raise (Straps)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"STRAPS"}','shoulder_isolation','bilateral','neutral',NULL,'DOUBLE',NULL,0.001804796,'{}',NULL,FALSE,FALSE,NULL),
('Y030qNm3LisddglM','Lateral Raise','Lateral Raise (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','unilateral','pronated',NULL,'DOUBLE',NULL,0.001325556,'{}',NULL,FALSE,FALSE,NULL),
('qfeYOQWqoOIAw_0H','Lateral Raise','Lateral Raise (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','unilateral','neutral',NULL,'DOUBLE',NULL,0.001896565,'{}',NULL,FALSE,FALSE,NULL),
('rIjnJFQUK3mDbwBW','Lateral Raise','Lateral Raise (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','bilateral','neutral',NULL,'DOUBLE',NULL,0.011868831,'{}',NULL,FALSE,FALSE,NULL),
('444f2537-5323-4383-a5ef-f6a4713089e6','Lateral Shoot Through','Lateral Shoot Through',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","shoulders"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('6f2112ee-73db-44e8-bef7-cd159b240ee6','Lawnmower SA Row','Lawnmower SA Row',NULL,'BACK','{"BACK"}','{"upper_back"}','{"HANDLES"}','row','unilateral','neutral',NULL,'DOUBLE',NULL,0.004241781,'{}',NULL,FALSE,FALSE,NULL),
('mp97oJ4W0SI78jvT','Leg Lower','Leg Lower',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000193735,'{}',NULL,FALSE,FALSE,NULL),
('3Z7atG3_ZBQ4OUF2','Leg Lower w Press','Leg Lower w Press',NULL,'ARMS','{"ARMS","CHEST","CORE"}','{"chest","core","triceps"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000764744,'{}',NULL,FALSE,FALSE,NULL),
('qBo43vpQrKDn3MNW','Leg Lower w/ Isometric Press','Leg Lower w/ Isometric Press',NULL,'ARMS','{"ARMS","CORE"}','{"core","triceps"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00032629,'{}',NULL,FALSE,FALSE,NULL),
('edf191ba-df39-45a3-b2b2-d14c266fc805','Low Bar Squat','Low Bar Squat','1. Setup: Attach the bar and long safety cables. Stand with your feet shoulder-width apart and place the bar tightly against the ‘shelf’ of your mid back, just below your shoulder muscles (posterior deltoids). Grip the bar with both hands wider than shoulder-width apart.

2. Positioning: Keep your chest up, shoulders back, and engage your core for stability. Look straight ahead or slightly upward.

3. Squatting: Initiate the squat by pushing your hips back and bending your knees. Lower your body down, as if you''re sitting back into an imaginary chair.

4. Depth: Descend until your thighs are at least parallel to the ground or lower if your mobility allows comfortably. Your knees should track in line with your toes.

5. Rising: Push through your heels and extend your hips and knees simultaneously to return to the starting position. Keep your chest up throughout the movement.','LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BAR","GREY_CABLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.022330532,'{"Back Squat"}',NULL,FALSE,FALSE,NULL),
('vvG84utDyVrhhcJB','Lunge','Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BELT"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.000672974,'{"Belt lunge"}',NULL,FALSE,FALSE,NULL),
('quqCUFHCothZ1u2_','Lunge Pulses','Lunge Pulses',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"BAR","GREY_CABLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.000234521,'{}',NULL,FALSE,FALSE,NULL),
('zh9OICfiuWpUzFOl','Lunge w/ Bicep Curl','Lunge w/ Bicep Curl',NULL,'ARMS','{"ARMS","LEGS"}','{"biceps","calves","glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000061179,'{}',NULL,FALSE,FALSE,NULL),
('xmHV0WcogmH6JHUD','Lunge w/ Knee Drive','Lunge w/ Knee Drive',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('2d576803-aaaa-414b-8e9f-c79a771ca0a6','Lunge w/ Shoulder Press','Lunge w/ Shoulder Press',NULL,'LEGS','{"LEGS","SHOULDERS"}','{"glutes","hamstrings","quads","shoulders"}','{"HANDLES"}','shoulder_press','alternating',NULL,NULL,'DOUBLE',NULL,0.000071376,'{}',NULL,FALSE,FALSE,NULL),
('SNST6WaWx0UFbOW7','Lying External Shoulder Rotation','Lying External Shoulder Rotation (Bench)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BENCH","HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000499632,'{}',NULL,FALSE,FALSE,NULL),
('WHNs4slzrNpbufWN','Lying External Shoulder Rotation','Lying External Shoulder Rotation (Bench)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BENCH","STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000081572,'{}',NULL,FALSE,FALSE,NULL),
('D1Y2OXKWho0zFgv9','Lying External Shoulder Rotation','Lying External Shoulder Rotation (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('022e4412-1a63-4b75-8685-11f8a1136f56','Lying Flys','Lying Flys',NULL,'CHEST','{"CHEST","SHOULDERS"}','{"chest","shoulders"}','{"HANDLES"}','fly','bilateral',NULL,NULL,'DOUBLE',NULL,0.002171873,'{}',NULL,FALSE,FALSE,NULL),
('fLu7cq8ndoGD7o1N','Lying Glute Kickback','Lying Glute Kickback',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.000448649,'{}',NULL,FALSE,FALSE,NULL),
('xh7phUUawthAuF41','Lying Hamstring Curl','Lying Hamstring Curl (Bench)','1. Facing the side of the trainer, position the short leg of the bench on top. The long leg should be up against the short edge of the trainer. The middle of the bench should line up with the cable.

2. Setup: Attach the ankle strap attachment and double adaptor to your leg. Lie face down on the bench with your legs extended off the end towards the cable inlet you are using.

3. Positioning: Your legs should be straight and aligned with the bench.

4. Curling: Bend your knees and pull your heels toward your glutes, contracting your hamstrings.

5. Squeezing: At the top of the movement, hold the contraction for a brief moment and squeeze your hamstrings. Ensure that your hip is always in touch with the bench.

6. Lowering: Slowly lower your legs back to the starting position with control.','LEGS','{"LEGS"}','{"hamstrings"}','{"BENCH","STRAPS"}','hamstring_curl','bilateral',NULL,NULL,'DOUBLE',NULL,0.006495227,'{}',NULL,FALSE,FALSE,NULL),
('cJkTi7rZz0DmvcIF','Lying Hamstring Curl','Lying Hamstring Curl (Straps)',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"STRAPS"}','hamstring_curl','bilateral',NULL,NULL,'DOUBLE',NULL,0.000958479,'{}',NULL,FALSE,FALSE,NULL),
('IIglddaLiD3aFW9a','Lying Leg Extension','Lying Leg Extension (Straps)',NULL,'LEGS','{"LEGS"}','{"quads"}','{"STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.001152214,'{}',NULL,FALSE,FALSE,NULL),
('K-YedLFEl0jIZ0Oy','Lying Leg Extension','Lying Leg Extension (Straps)',NULL,'LEGS','{"LEGS"}','{"quads"}','{"STRAPS"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000856513,'{}',NULL,FALSE,FALSE,NULL)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name, muscle_group=EXCLUDED.muscle_group, muscle_groups=EXCLUDED.muscle_groups, muscles=EXCLUDED.muscles, equipment=EXCLUDED.equipment, movement=EXCLUDED.movement, sidedness=EXCLUDED.sidedness, grip=EXCLUDED.grip, grip_width=EXCLUDED.grip_width, popularity=EXCLUDED.popularity, aliases=EXCLUDED.aliases, archived=EXCLUDED.archived, updated_at=NOW();

INSERT INTO exercise_catalog (id, name, display_name, description, muscle_group, muscle_groups, muscles, equipment, movement, sidedness, grip, grip_width, default_cable_config, min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom, user_id) VALUES
('yEp_qL0Rdlu8lURJ','Lying Leg Extension','Lying Leg Extension (Bench)',NULL,'LEGS','{"LEGS"}','{"quads"}','{"BENCH","SHORT_BAR","STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000571009,'{}',NULL,FALSE,FALSE,NULL),
('Xcaj16Dwf3CFZp7G','Lying Leg Extension','Lying Leg Extension (Bench)',NULL,'LEGS','{"LEGS"}','{"quads"}','{"BENCH","STRAPS"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000989069,'{}',NULL,FALSE,FALSE,NULL),
('128a2325-bee2-46e5-9124-1d2f2f44f44c','Lying Leg Extension','Lying Leg Extension (Bench)',NULL,'LEGS','{"LEGS"}','{"quads"}','{"BENCH","STRAPS"}','leg_extension','unilateral',NULL,NULL,'DOUBLE',NULL,0.00176401,'{}',NULL,FALSE,FALSE,NULL),
('d476fb75-69c2-44c9-8cb5-f477572a20c4','Lying Pec Fly','Lying Pec Fly',NULL,'CHEST','{"CHEST","SHOULDERS"}','{"chest","shoulders"}','{"BENCH","HANDLES"}','fly','bilateral',NULL,NULL,'DOUBLE',NULL,0.017945998,'{}',NULL,FALSE,FALSE,NULL),
('KoL_gx00nuf2wncV','Medial Delt Twist','Medial Delt Twist',NULL,'CORE','{"CORE","SHOULDERS"}','{}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('kSLyRg4bjLuzTeIM','Medial Delt Twist','Medial Delt Twist',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{}','shoulder_isolation','alternating',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('2S9GLUWvISCI0RFC','Mountain Climber','Mountain Climber',NULL,'CORE','{"CORE"}','{"core"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000081572,'{}',NULL,FALSE,FALSE,NULL),
('b905e73f-fb98-4fc6-aa70-e949fec85168','Muscle Clean & Press','Muscle Clean & Press',NULL,'ARMS','{"ARMS","BACK","SHOULDERS"}','{"shoulders","traps","triceps"}','{"BAR","BLACK_CABLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.00080553,'{}',NULL,FALSE,FALSE,NULL),
('NmuYV1NROjrd0NaU','Neutral Grip Bench Press','Neutral Grip Bench Press (Bench)',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BENCH","HANDLES"}','chest_press','bilateral','neutral',NULL,'DOUBLE',NULL,0.00035688,'{}',NULL,FALSE,FALSE,NULL),
('-5NkaLCrlHvAt0Or','Neutral Grip Bench Press','Neutral Grip Bench Press (Bench)',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BENCH","HANDLES"}','chest_press','bilateral','neutral',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('547f2b6e-3ff8-485f-8250-2be98d7c308b','Neutral Grip Floor Press w/ Glute Bridge','Neutral Grip Floor Press w/ Glute Bridge',NULL,'ARMS','{"ARMS","CHEST","LEGS"}','{"chest","glutes","hamstrings","triceps"}','{"HANDLES"}','chest_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.000377273,'{}',NULL,FALSE,FALSE,NULL),
('30916191-9c65-49a8-83c9-c1a90c4ecdf0','Neutral Grip SA Row','Neutral Grip SA Row',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"HANDLES"}','row','unilateral','neutral',NULL,'DOUBLE',NULL,0.000244718,'{}',NULL,FALSE,FALSE,NULL),
('6554009f-e200-44db-8630-41b477beebb1','Neutral SA Shoulder Press (Inside)','Neutral SA Shoulder Press (Inside)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','unilateral','neutral',NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,FALSE,FALSE,NULL),
('jWS9wZZCxvD9dId8','Outward Bicep Curl','Outward Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.002681703,'{}',NULL,FALSE,FALSE,NULL),
('fzx9ee24mUvP9myC','Outward SA Bicep Curl','Outward SA Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','unilateral','supinated',NULL,'DOUBLE',NULL,0.00035688,'{}',NULL,FALSE,FALSE,NULL),
('e467f6b8-1e92-4571-b3e6-c020ca7099c3','Overhead Press','Overhead Press',NULL,'ARMS','{"ARMS","SHOULDERS"}','{"triceps"}','{"HANDLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000377273,'{}',NULL,TRUE,FALSE,NULL),
('iXyCCE5OzEeOL72t','Overhead Squat','Overhead Squat',NULL,'BACK','{"BACK","CORE","LEGS","SHOULDERS"}','{"calves","core","glutes","hamstrings","quads","shoulders","traps","upper_back"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000265111,'{}',NULL,FALSE,FALSE,NULL),
('qzYXOq7xVNS-9gcT','Overhead Tricep Bar Extension','Overhead Tricep Bar Extension',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"SHORT_BAR"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.004986132,'{}',NULL,FALSE,FALSE,NULL),
('_i1E704BS8bngWrv','Overhead Tricep Extension','Overhead Tricep Extension (Bar)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BAR","GREY_CABLES"}','tricep_extension','bilateral','supinated',NULL,'DOUBLE',NULL,0.00122359,'{"supinated tricep extension"}',NULL,FALSE,FALSE,NULL),
('L3m5K_4X7ztA2yXV','Overhead Tricep Extension','Overhead Tricep Extension (Bar)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BAR","BLACK_CABLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.000927889,'{"pronated tricep extension"}',NULL,FALSE,FALSE,NULL),
('RASpI84AvAi3ucvr','Overhead Tricep Extension','Overhead Tricep Extension (Rope)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"ROPE"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.012735541,'{}',NULL,FALSE,FALSE,NULL),
('e3c59976-efa7-4e7d-8848-77e864ba1d0f','Overhead Tricep Extension','Overhead Tricep Extension (Handles)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.00391549,'{"SA Overhead Tricep Extension"}',NULL,FALSE,FALSE,NULL),
('bf1437e9-f8ca-4bfe-b766-af5fee1834a5','Overhead Tricep Extension','Overhead Tricep Extension (Handles)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.004160208,'{}',NULL,FALSE,FALSE,NULL),
('1dcc023d-b326-4b48-bd31-b3cdebba3ac8','Pallof Press','Pallof Press',NULL,'ARMS','{"ARMS","CORE","SHOULDERS"}','{"core","shoulders","triceps"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.001376539,'{}',NULL,FALSE,FALSE,NULL),
('wKPa4Aa0r_CxAQgN','Pidgeon Stretch','Pidgeon Stretch',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","quads"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('oiMw4v1LrceC02LN','Pigeon (Assisted)','Pigeon (Assisted)',NULL,'General','{}','{}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('HR3hn_5rarrq73qw','Pike Push Up','Pike Push Up',NULL,'ARMS','{"ARMS","BACK","SHOULDERS"}','{"shoulders","triceps","upper_back"}','{}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,FALSE,FALSE,NULL),
('hcWWZ4_kB2Ukps4r','Pistol Squat','Pistol Squat (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000183538,'{}',NULL,FALSE,FALSE,NULL),
('WEM5B4mlGozBpuLV','Pistol Squat','Pistol Squat (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BELT"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('UHLV7OA_q4D4UBk5','Pistol Squat','Pistol Squat',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('U9nn8f-vcAltrR-E','Plank','Plank',NULL,'BACK','{"BACK","CORE","LEGS"}','{"core","glutes","lats","upper_back"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001274573,'{}',NULL,FALSE,FALSE,NULL),
('_YQXCLQ49sZ9xus0','Plank & Rotation','Plank & Rotation',NULL,'BACK','{"BACK","CORE","LEGS"}','{"core","glutes","lats","upper_back"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('uXHXPtiaxE27nIwE','Plank Jacks','Plank Jacks',NULL,'ARMS','{"ARMS","BACK","CORE","LEGS"}','{"biceps","core","glutes","hamstrings","lats","upper_back"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('08uL8Rd_dMyUWmon','Plank w/ Shoulder Tap','Plank w/ Shoulder Tap',NULL,'BACK','{"BACK","CORE","SHOULDERS"}','{"core","lats","obliques","shoulders","upper_back"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000234521,'{}',NULL,FALSE,FALSE,NULL),
('4ksnpJ1IfVp7QH5n','Preacher Curl','Preacher Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BENCH","HANDLES"}',NULL,'unilateral','supinated',NULL,'DOUBLE',NULL,0.001162411,'{}',NULL,FALSE,FALSE,NULL),
('JSKDIBv70sJdwaSX','Progressed Inchworm','Progressed Inchworm',NULL,'General','{}','{}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('qoA-t0Aa6EdiK1z-','Pronated Seated Wrist Curls','Pronated Seated Wrist Curls',NULL,'ARMS','{"ARMS"}','{"forearms"}','{"BENCH","SHORT_BAR"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.000652581,'{}',NULL,FALSE,FALSE,NULL),
('F0CpuwCmcgtM_E0n','Pronated Wrist Curls','Pronated Wrist Curls',NULL,'ARMS','{"ARMS"}','{"biceps","forearms"}','{"SHORT_BAR"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.001458112,'{}',NULL,FALSE,FALSE,NULL),
('282ae5c8-3237-4b36-9545-b3bfcdbb7186','Prone Lat Pullover','Prone Lat Pullover',NULL,'ARMS','{"ARMS","BACK"}','{"lats","triceps"}','{"BENCH","HANDLES"}',NULL,'unilateral','pronated',NULL,'DOUBLE',NULL,0.002589933,'{}',NULL,FALSE,FALSE,NULL),
('9eb0aa7a-f91b-415c-ac95-1f3e66e2bb79','Pull Through','Pull Through (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001468308,'{}',NULL,FALSE,FALSE,NULL),
('LoaPkKfJhQSfn-vH','Pull Through','Pull Through (Rope)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002161677,'{}',NULL,FALSE,FALSE,NULL),
('7va2ht0vPUhOE9g_','Pull-ups','Pull-ups',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BELT"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('1yRM4s2GawA9w3mE','Pullover','Pullover (Short Bar)',NULL,'ARMS','{"ARMS","BACK","CHEST"}','{"chest","lats","triceps"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000367077,'{}',NULL,FALSE,FALSE,NULL),
('fZSw0ohInfxQnOmN','Pullover','Pullover (Bench)',NULL,'ARMS','{"ARMS","BACK","CHEST"}','{"chest","lats","triceps"}','{"BENCH","ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00349743,'{}',NULL,FALSE,FALSE,NULL),
('Tr5k89TXxDznw-re','Pullover','Pullover (Bench)',NULL,'ARMS','{"ARMS","BACK","CHEST"}','{"chest","lats","triceps"}','{"BENCH","SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001916958,'{}',NULL,FALSE,FALSE,NULL),
('XnLDPIrt-UB8UHe_','Pullover','Pullover (Handles)',NULL,'ARMS','{"ARMS","BACK","CHEST"}','{"chest","lats","triceps"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001774206,'{}',NULL,FALSE,FALSE,NULL),
('WvU4CAjaUzYto-HK','Pullover','Pullover (Bench)',NULL,'ARMS','{"ARMS","BACK","CHEST"}','{"chest","lats","triceps"}','{"BENCH","HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002589933,'{}',NULL,FALSE,FALSE,NULL),
('060MtnqsajfwLfCG','Push Up','Push Up (Belt)',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000254914,'{"Belt Push Up"}',NULL,FALSE,FALSE,NULL),
('COPwrFLlJNQGK1x_','Push Up','Push Up',NULL,'ARMS','{"ARMS","CHEST","CORE"}','{"chest","core","triceps"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001182804,'{}',NULL,FALSE,FALSE,NULL),
('h2AvnFc5IUvR5Rsy','Quadruped Oblique Crunch','Quadruped Oblique Crunch',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('xWS1Dz47uN0Lvikf','Quadruped Shoulder Taps','Quadruped Shoulder Taps',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('Pa7L7GPGmD7zSNOr','Rack Pull','Rack Pull',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"BAR","BLACK_CABLES"}','deadlift','bilateral','pronated',NULL,'DOUBLE',NULL,0.000632188,'{}',NULL,FALSE,FALSE,NULL),
('KLl6MIB5BPwo7Ere','Raf''s Core Exercise','Raf''s Core Exercise',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"BENCH","STRAPS"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001101231,'{"Leg Lower","Hip Lifts"}',NULL,FALSE,FALSE,NULL),
('0zZA4M7uhQ9zi-qi','Rear Delt Fly','Rear Delt Fly (Handles)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"HANDLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.002131087,'{}',NULL,FALSE,FALSE,NULL),
('w7GvCyjz7FQ_18iw','Rear Delt Fly','Rear Delt Fly (Handles)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000693368,'{}',NULL,FALSE,FALSE,NULL),
('L1rpJxWOVkooOilR','Rear Delt Row','Rear Delt Row',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps","upper_back"}','{"BAR","BLACK_CABLES"}','row','bilateral','pronated',NULL,'DOUBLE',NULL,0.001233787,'{}',NULL,FALSE,FALSE,NULL),
('abb1ce56-759d-4cd9-af94-c14c0d7537c7','Renegade Row','Renegade Row',NULL,'ARMS','{"ARMS","BACK","CORE"}','{"biceps","core","lats","triceps","upper_back"}','{"HANDLES"}','row','unilateral','neutral',NULL,'DOUBLE',NULL,0.002671506,'{}',NULL,FALSE,FALSE,NULL),
('qbcMU1eW8y3PBRxk','Reverse Crunch','Reverse Crunch',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000071376,'{}',NULL,FALSE,FALSE,NULL),
('iIh4XO5YfBOm1yL-','Reverse Lunge','Reverse Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,TRUE,FALSE,NULL),
('0TxEMNqgtYWzFf7D','Reverse Lunge (SC)','Reverse Lunge (SC)',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"HANDLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.002447181,'{}',NULL,FALSE,FALSE,NULL),
('dFzr_9Ii894yDsLe','Reverse Lunge w/ Shoulder Press','Reverse Lunge w/ Shoulder Press',NULL,'LEGS','{"LEGS","SHOULDERS"}','{"glutes","hamstrings","quads","shoulders"}','{"HANDLES"}','shoulder_press','unilateral','neutral',NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('WAB_Z7EUGeUxF9ce','Romanian Deadlift','Romanian Deadlift (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"HANDLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.001264377,'{}',NULL,FALSE,FALSE,NULL),
('1c4f037a-1cab-4133-b72a-458be3e7018d','Romanian Deadlift','Romanian Deadlift (Bar)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","lower_back","upper_back"}','{"BAR"}','deadlift','bilateral','pronated',NULL,'DOUBLE',NULL,0.012715148,'{}',NULL,FALSE,FALSE,NULL),
('rMYzHKGP3u9agdih','Romanian Deadlift','Romanian Deadlift (Short Bar)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","lower_back","upper_back"}','{"SHORT_BAR"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.002375805,'{}',NULL,FALSE,FALSE,NULL),
('49c4594c-f997-4d70-8008-b293e247e2e4','Romanian Deadlift','Romanian Deadlift (Handles)','1. Setup: Stand with your feet shoulder-width apart and hold a handle in each hand with palms facing your body.

2. Positioning: Keep your back straight, shoulders back, and engage your core for stability.

3. Bending: Hinge at the hips and push your hips back as you lower the weights down your thighs. Keep a slight bend in your knees throughout the movement.

4. Lowering: Lower the handles toward the ground while maintaining a straight back and a slight bend in your knees. Keep the handles close to your legs throughout the movement.

5. Squeezing: Once you feel a stretch in your hamstrings, reverse the movement and return to the starting position by squeezing your glutes and pushing your hips forward.','BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","lower_back","upper_back"}','{"HANDLES"}','deadlift','bilateral','pronated',NULL,'DOUBLE',NULL,0.010747206,'{}',NULL,FALSE,FALSE,NULL),
('lgYX50v_dhlQzGkS','Russian Twist','Russian Twist',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('mfBF5EZDbOgIzoqK','SA Bench Press','SA Bench Press',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"BENCH","HANDLES"}','chest_press','unilateral','pronated',NULL,'DOUBLE',NULL,0.001753813,'{}',NULL,FALSE,FALSE,NULL),
('WGC8yyeuikjTpwFv','SA Bent Over Row','SA Bent Over Row',NULL,'BACK','{"BACK"}','{"lats","traps","upper_back"}','{"HANDLES"}','row','unilateral','pronated',NULL,'DOUBLE',NULL,0.000183538,'{}',NULL,FALSE,FALSE,NULL),
('2d798867-d392-433c-8a5c-ea81f9091fb7','SA Bent Over Row - Reverse Grip','SA Bent Over Row - Reverse Grip',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"HANDLES"}','row','unilateral','supinated',NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,FALSE,FALSE,NULL),
('ru7mTLyeqg5JpRQg','SA Bicep Curl','SA Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"HANDLES"}','bicep_curl','unilateral','supinated',NULL,'DOUBLE',NULL,0.000795334,'{}',NULL,FALSE,FALSE,NULL),
('nN6qtG3fAljE_Z83','SA Bicycle Crunch','SA Bicycle Crunch',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000214128,'{}',NULL,FALSE,FALSE,NULL),
('8e29ca58-5069-4047-8332-5fee7705948e','SA Crossover Squat & Press','SA Crossover Squat & Press',NULL,'BACK','{"BACK","LEGS","SHOULDERS"}','{"glutes","hamstrings","quads","shoulders","upper_back"}','{"HANDLES"}',NULL,'unilateral','pronated',NULL,'DOUBLE',NULL,0.000632188,'{}',NULL,FALSE,FALSE,NULL),
('95Y3m1BFa2p2mrDk','SA Curl and Press','SA Curl and Press',NULL,'ARMS','{"ARMS","SHOULDERS"}','{"biceps","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('ttHTA71H0f3mB31g','SA Floor Press','SA Floor Press',NULL,'ARMS','{"ARMS","CHEST"}','{"chest","triceps"}','{"HANDLES"}','chest_press','unilateral',NULL,NULL,'DOUBLE',NULL,0.000499632,'{}',NULL,FALSE,FALSE,NULL),
('U6M_Wf-AewcK3CnD','SA Hammer Curl','SA Hammer Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"ROPE"}','bicep_curl','unilateral','neutral',NULL,'DOUBLE',NULL,0.000214128,'{}',NULL,FALSE,FALSE,NULL),
('48683355-ee78-40f8-89fb-384bdfc9997d','SA Punch','SA Punch',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000876906,'{}',NULL,FALSE,FALSE,NULL),
('GIQYOXGxJkgszu1e','SA Rear Delt Fly Bench Supported','SA Rear Delt Fly Bench Supported',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"BENCH","HANDLES"}',NULL,'unilateral','pronated',NULL,'DOUBLE',NULL,0.000897299,'{"Reverse Fly"}',NULL,FALSE,FALSE,NULL),
('59af78e5-96b2-4cc1-bc40-350b78b55224','SA Shoulder Press','SA Shoulder Press (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','unilateral',NULL,NULL,'DOUBLE',NULL,0.000662778,'{}',NULL,FALSE,FALSE,NULL),
('93b9131e-2976-4ea7-94e7-a029ec799c67','SA Shoulder Press','SA Shoulder Press (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','unilateral',NULL,NULL,'DOUBLE',NULL,0.001294966,'{}',NULL,FALSE,FALSE,NULL),
('02375fb3-3a7f-48aa-9db4-9c0a2ab3a9e5','SA Shoulder Press - Lunge Hold','SA Shoulder Press - Lunge Hold',NULL,'ARMS','{"ARMS","LEGS","SHOULDERS"}','{"calves","glutes","hamstrings","quads","triceps"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000254914,'{}',NULL,FALSE,FALSE,NULL),
('o9UBgAOU0nw2EfzY','SA Shoulder Press (Inside)','SA Shoulder Press (Inside)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','unilateral','pronated',NULL,'DOUBLE',NULL,0.000132555,'{}',NULL,FALSE,FALSE,NULL),
('6a965651-ed7a-4fb6-a676-c95bc3f244d7','SA Thruster','SA Thruster',NULL,'LEGS','{"LEGS","SHOULDERS"}','{"glutes","quads","shoulders"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('3aoNnPe1hglnTZ-s','SA Upper Cut','SA Upper Cut',NULL,'ARMS','{"ARMS","CHEST","CORE","SHOULDERS"}','{"biceps","chest","core","shoulders","triceps"}','{"HANDLES"}','fly','unilateral','supinated',NULL,'DOUBLE',NULL,0.001366343,'{}',NULL,FALSE,FALSE,NULL),
('ArAbShPxyzqLCyA8','SA Wrist Curl','SA Wrist Curl (Handles)',NULL,'ARMS','{"ARMS"}','{"forearms"}','{"HANDLES"}',NULL,'unilateral','pronated',NULL,'DOUBLE',NULL,0.000479239,'{}',NULL,FALSE,FALSE,NULL),
('kPq2JUnIZhTRv9ap','SA Wrist Curl','SA Wrist Curl (Bench)',NULL,'ARMS','{"ARMS"}','{"forearms"}','{"BENCH","HANDLES"}',NULL,'unilateral','pronated',NULL,'DOUBLE',NULL,0.000132555,'{"Pronated Wrist Curl"}',NULL,FALSE,FALSE,NULL),
('a8_tAX7to3xRrMnQ','Scorpion Stretch','Scorpion Stretch',NULL,'CHEST','{"CHEST"}','{"chest"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,FALSE,FALSE,NULL),
('xfANU256X8tv1hUU','Seated Bicep Curl','Seated Bicep Curl (Bench)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BENCH","HANDLES"}','bicep_curl','unilateral','supinated',NULL,'DOUBLE',NULL,0.000530222,'{}',NULL,FALSE,FALSE,NULL),
('I4ZzPJg0qt7dw8sV','Seated Bicep Curl','Seated Bicep Curl (Bench)',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BENCH","HANDLES"}','bicep_curl','bilateral',NULL,NULL,'DOUBLE',NULL,0.00266131,'{}',NULL,FALSE,FALSE,NULL),
('4e437374-5b96-4e9f-bf20-5ad275266fb6','Seated Calf Raise','Seated Calf Raise (Bar)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"BAR","BENCH","BLACK_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001040052,'{}',NULL,FALSE,FALSE,NULL),
('uswNmWgAK9AdRXja','Seated Calf Raise','Seated Calf Raise (Bench)',NULL,'LEGS','{"LEGS"}','{"calves"}','{"BENCH","SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000458846,'{}',NULL,FALSE,FALSE,NULL),
('nFR6tLChZbdWvLhP','Seated Concentration Curl','Seated Concentration Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BENCH","HANDLES"}','bicep_curl','unilateral','supinated',NULL,'DOUBLE',NULL,0.002906028,'{}',NULL,FALSE,FALSE,NULL),
('VdQc5XkuKLuauqhn','Seated Leg Extension','Seated Leg Extension',NULL,'LEGS','{"LEGS"}','{"quads"}','{"BENCH","STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.00263072,'{}',NULL,FALSE,FALSE,NULL),
('GfdnN4MlZrweuEbe','Seated Overhead Tricep Extension','Seated Overhead Tricep Extension (Bench)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH","SHORT_BAR"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.002426788,'{}',NULL,FALSE,FALSE,NULL),
('pWWQdfycIrKmbVTS','Seated Overhead Tricep Extension','Seated Overhead Tricep Extension (Handles)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.000520026,'{}',NULL,FALSE,FALSE,NULL),
('j7YZvM4iUfMsm1Cj','Seated Rear Delt Row','Seated Rear Delt Row',NULL,'BACK','{"BACK","SHOULDERS"}','{"lats","shoulders","traps","upper_back"}','{"BENCH","HANDLES"}','row','bilateral','pronated',NULL,'DOUBLE',NULL,0.000581205,'{"Wide grip row"}',NULL,FALSE,FALSE,NULL),
('UHoVboL0UG5PobzU','Seated Row','Seated Row (Short Bar)',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"SHORT_BAR"}',NULL,'bilateral','supinated',NULL,'DOUBLE',NULL,0.000948282,'{}',NULL,FALSE,FALSE,NULL),
('tn8HJeXMdU_8IDT_','Seated Row','Seated Row (Bench)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BENCH","SHORT_BAR"}',NULL,'bilateral','supinated',NULL,'DOUBLE',NULL,0.003833917,'{"Underhand Seated Row","Supinated Seated Row"}',NULL,FALSE,FALSE,NULL),
('RlsTRSKnxy-NQ8DY','Seated Row','Seated Row (Bench)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BENCH","HANDLES"}','row','bilateral','neutral',NULL,'DOUBLE',NULL,0.001345949,'{}',NULL,FALSE,FALSE,NULL),
('6wzKESB8SJc5h7Vu','Seated Row','Seated Row (Bar)',NULL,'BACK','{"BACK"}','{"upper_back"}','{"BAR"}','row','bilateral','pronated',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('dn1p_QdQgEyMS1y8','Seated Row','Seated Row (Bench)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BENCH","SHORT_BAR"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.002171873,'{}',NULL,FALSE,FALSE,NULL)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name, muscle_group=EXCLUDED.muscle_group, muscle_groups=EXCLUDED.muscle_groups, muscles=EXCLUDED.muscles, equipment=EXCLUDED.equipment, movement=EXCLUDED.movement, sidedness=EXCLUDED.sidedness, grip=EXCLUDED.grip, grip_width=EXCLUDED.grip_width, popularity=EXCLUDED.popularity, aliases=EXCLUDED.aliases, archived=EXCLUDED.archived, updated_at=NOW();

INSERT INTO exercise_catalog (id, name, display_name, description, muscle_group, muscle_groups, muscles, equipment, movement, sidedness, grip, grip_width, default_cable_config, min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom, user_id) VALUES
('6lVw6FkK5vYW8lGl','Seated Row','Seated Row (Bench)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BENCH","ROPE"}',NULL,'bilateral','neutral',NULL,'DOUBLE',NULL,0.001437719,'{}',NULL,FALSE,FALSE,NULL),
('6cpDDeMzOKRsKKYv','Seated Row','Seated Row (Bench)',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BENCH","HANDLES"}','row','bilateral','supinated',NULL,'DOUBLE',NULL,0.000938086,'{"Reverse grip Seated Row","Underhand Seated Row"}',NULL,FALSE,FALSE,NULL),
('lqezCotrgYPfpuDg','Seated Row','Seated Row (Bench)',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"BENCH","HANDLES"}',NULL,'bilateral','neutral',NULL,'DOUBLE',NULL,0.003069173,'{}',NULL,FALSE,FALSE,NULL),
('T5PUUfKqJit3qCvD','Seated SA Lateral Raise','Seated SA Lateral Raise',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BENCH","STRAPS"}','shoulder_isolation','unilateral','neutral',NULL,'DOUBLE',NULL,0.000397667,'{}',NULL,FALSE,FALSE,NULL),
('6b9d0649-6f92-4e91-8db0-1170f3a33f4b','Seated SA Oblique Press','Seated SA Oblique Press',NULL,'ARMS','{"ARMS","BACK","CORE","SHOULDERS"}','{"core","shoulders","triceps","upper_back"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000723957,'{}',NULL,FALSE,FALSE,NULL),
('nR-lOrEDQJ0L0Vyu','Seated SA Overhead Tricep Extension','Seated SA Overhead Tricep Extension',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH","HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000336487,'{}',NULL,FALSE,FALSE,NULL),
('aHq0L7BGJ421LjAl','Seated SA Rear Delt Row','Seated SA Rear Delt Row',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","upper_back"}','{"BENCH","HANDLES"}','row','unilateral',NULL,NULL,'DOUBLE',NULL,0.000132555,'{}',NULL,FALSE,FALSE,NULL),
('8xfEOJJincwXHQqt','Seated SA Row','Seated SA Row',NULL,'ARMS','{"ARMS","BACK"}','{"biceps","lats","upper_back"}','{"BENCH","HANDLES"}','row','unilateral','neutral',NULL,'DOUBLE',NULL,0.000458846,'{}',NULL,FALSE,FALSE,NULL),
('e8ded86f-112d-45ca-9e6e-8b9adf71a787','Seated SA Shoulder Press','Seated SA Shoulder Press',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','unilateral',NULL,NULL,'DOUBLE',NULL,0.000336487,'{}',NULL,FALSE,FALSE,NULL),
('8IjpojkVyCE8GEob','Seated Shoulder Press','Seated Shoulder Press (Bench)',NULL,'ARMS','{"ARMS","SHOULDERS"}','{"triceps"}','{"BENCH","HANDLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.001916958,'{}',NULL,TRUE,FALSE,NULL),
('DAMowL4fXivfWnFF','Seated Shoulder Press','Seated Shoulder Press (Handles)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','bilateral','pronated',NULL,'DOUBLE',NULL,0.003201729,'{}',NULL,FALSE,FALSE,NULL),
('GukBjh5fv1FBUvO1','Seated Shoulder Press','Seated Shoulder Press (Bench)',NULL,'SHOULDERS','{"SHOULDERS"}','{}','{"BENCH","HANDLES"}','shoulder_press','bilateral','neutral',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('oFlrSYKQ2ZpmyP69','Seated Shoulder Press','Seated Shoulder Press (Bench)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BENCH","HANDLES"}','shoulder_press','bilateral','neutral',NULL,'DOUBLE',NULL,0.002651113,'{}',NULL,FALSE,FALSE,NULL),
('9ekHzCsiV_EbzS0Q','Seated Shoulder Press','Seated Shoulder Press (Bench)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BENCH","HANDLES"}','shoulder_press','bilateral','pronated',NULL,'DOUBLE',NULL,0.003028387,'{}',NULL,FALSE,FALSE,NULL),
('IellRPhjOXa5Rlc4','Seated Spinal Twist','Seated Spinal Twist',NULL,'BACK','{"BACK","LEGS"}','{"abductors","glutes","lats","lower_back","quads"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('Bff9--feKFxbNzFk','Shoot Throughs','Shoot Throughs',NULL,'ARMS','{"ARMS","CORE","LEGS","SHOULDERS"}','{"calves","core","glutes","hamstrings","quads","shoulders","triceps"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('XgPSiQhDOFgjCBWZ','Shoulder External Rotator','Shoulder External Rotator',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_isolation','unilateral','neutral',NULL,'DOUBLE',NULL,0.000744351,'{}',NULL,FALSE,FALSE,NULL),
('0040d53f-85c7-4564-b14e-9b38c979b461','Shoulder Press','Shoulder Press (Handles)','1. Setup: Stand with your feet shoulder-width apart, holding a handle in each hand at shoulder level. Your palms should be facing forward, and your elbows should be bent.

2. Positioning: Keep your back straight, chest up, and engage your core for stability.

3. Pressing: Push the cables upward by fully extending your arms.

4. Alignment: As you lift, the handles should come close together, but avoid letting them touch at the top of the movement.

5. Lowering: Lower the handles back down to shoulder level with control.','SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.012623378,'{}',NULL,FALSE,FALSE,NULL),
('68c3b06f-1767-44fd-9676-e1a4d1c7699b','Shoulder Press','Shoulder Press (Bar)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"BAR","BLACK_CABLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.019659026,'{"Strict Press","Bar Shoulder Press","Bar Strict Press","Overhead Press","Military Press"}',NULL,FALSE,FALSE,NULL),
('37dfe4b0-0e5f-485c-95d7-8cb3c75c82f1','Shoulder Press - Neutral Grip','Shoulder Press - Neutral Grip',NULL,'ARMS','{"ARMS","SHOULDERS"}','{"triceps"}','{"HANDLES"}','shoulder_press','bilateral','neutral',NULL,'DOUBLE',NULL,0.000458846,'{}',NULL,FALSE,FALSE,NULL),
('a696262a-b3ca-450a-844c-66593bffdb4f','Shoulder Press (Inside)','Shoulder Press (Inside)',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.000672974,'{}',NULL,FALSE,FALSE,NULL),
('1cAPp9FYOqgEFDfm','Shrug','Shrug (Short Bar)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps","upper_back"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00131536,'{}',NULL,FALSE,FALSE,NULL),
('149484fe-3baa-4601-97c5-8d273a6b455a','Shrug','Shrug (Bar)',NULL,'BACK','{"BACK","SHOULDERS"}','{"traps","upper_back"}','{"BAR","BLACK_CABLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000254914,'{}',NULL,TRUE,FALSE,NULL),
('e1e6eda5-42e7-45ee-82e6-ce97746ae0ca','Shrug','Shrug (Handles)','1. Setup: Stand with your feet shoulder-width apart, holding a handle each hand at your sides. Your palms should be facing your body.

2. Positioning: Keep your back straight, chest up, and engage your core for stability.

3. Shrugging: Lift your shoulders straight up toward your ears as high as possible. Avoid rolling your shoulders forward or backward. Try and stick to a large range of motion to allow the machine to adapt to you.

4. Squeezing: At the top of the movement, hold for a brief moment and squeeze your traps.

5. Lowering: Lower your shoulders back down to the starting position with control.','BACK','{"BACK","SHOULDERS"}','{"shoulders","traps","upper_back"}','{"HANDLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.00711722,'{}',NULL,FALSE,FALSE,NULL),
('MNyFj-nf0aJz74Fi','Shuffle','Shuffle',NULL,'LEGS','{"LEGS"}','{"quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,FALSE,FALSE,NULL),
('fac6aba0-44a3-4a97-8db4-7ec08c1d942b','Side Bend','Side Bend',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"HANDLES"}',NULL,'unilateral','neutral',NULL,'DOUBLE',NULL,0.008646708,'{}',NULL,FALSE,FALSE,NULL),
('sxNGWuwoGi53uzPQ','Side Clam Hip Dips','Side Clam Hip Dips',NULL,'CORE','{"CORE","LEGS"}','{"abductors","core","glutes"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('4SNNzLGB30i_svEv','Side Jumps','Side Jumps',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,FALSE,FALSE,NULL),
('b5GMOO29lfyvLAIH','Side Lunge','Side Lunge',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.001356146,'{}',NULL,FALSE,FALSE,NULL),
('91e92912-d281-4769-a85f-f7960fba7781','Side Lying Abduction','Side Lying Abduction',NULL,'LEGS','{"LEGS"}','{"abductors","glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.002865241,'{}',NULL,FALSE,FALSE,NULL),
('fXjy6W7tGL2O-kaB','Side Lying Hip Adduction','Side Lying Hip Adduction',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.001070641,'{}',NULL,FALSE,FALSE,NULL),
('0yBVwuQwNsQ3JKng','Side Plank','Side Plank',NULL,'CORE','{"CORE","LEGS","SHOULDERS"}','{"core","glutes","shoulders"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000897299,'{}',NULL,FALSE,FALSE,NULL),
('7KpeHFV0c18pWx0c','Side Plank Clam','Side Plank Clam',NULL,'CORE','{"CORE","LEGS","SHOULDERS"}','{"abductors","core","glutes","shoulders"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('fC_qGwvsTQFRD7Yz','Side Plank Hip Abduction','Side Plank Hip Abduction',NULL,'CORE','{"CORE","LEGS"}','{"abductors","core","glutes","obliques"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('4zUD8GNoHcRFbuzM','Side Plank Hip Dips','Side Plank Hip Dips',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000234521,'{}',NULL,FALSE,FALSE,NULL),
('wq7KZjMBqkMKXICc','Side Shuffle','Side Shuffle',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,FALSE,FALSE,NULL),
('46nKrULukv55x-ro','Single Leg Step Downs','Single Leg Step Downs',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000999265,'{}',NULL,FALSE,FALSE,NULL),
('f524875e-9c31-4102-99fc-7b4505e10ea5','Sit to Stand','Sit to Stand (Bar)',NULL,'BACK','{"BACK","LEGS"}','{"calves","glutes","hamstrings","lats","quads","upper_back"}','{"BAR","BENCH","GREY_CABLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000601598,'{}',NULL,FALSE,FALSE,NULL),
('qO01vy4Ba1tYOdlT','Sit to Stand','Sit to Stand (Belt)',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"BELT","BENCH"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000101965,'{}',NULL,FALSE,FALSE,NULL),
('iAlBEVYGhzdWuyC8','Sit Up','Sit Up',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000723957,'{}',NULL,FALSE,FALSE,NULL),
('L0Q3A8j4yzWCbFT5','Sit up','Sit up',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,TRUE,FALSE,NULL),
('n307ugHNg9TDrO8D','Skaters','Skaters',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,FALSE,FALSE,NULL),
('cOaTQ1ljsuUom_cn','Skull Crusher','Skull Crusher (Bench)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH","ROPE"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.004955542,'{}',NULL,FALSE,FALSE,NULL),
('NTtSMyHmJmTE7iQ5','Skull Crusher','Skull Crusher (Bench)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH","HANDLES"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.003477037,'{}',NULL,FALSE,FALSE,NULL),
('vI7FQn2KAPJxBS-n','Skull Crusher','Skull Crusher (Short Bar)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"SHORT_BAR"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.001519291,'{}',NULL,FALSE,FALSE,NULL),
('a1f4e3d7-8ab4-442d-ba06-8dfd9c11e248','Skull Crusher','Skull Crusher (Handles)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.001723223,'{}',NULL,FALSE,FALSE,NULL),
('6hCTlg47HzDa8KMH','Skull Crusher','Skull Crusher (Rope)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"ROPE"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.000234521,'{}',NULL,FALSE,FALSE,NULL),
('d99a9738-3828-42a6-815e-459c1f825ff9','Skull Crusher','Skull Crusher (Bench)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH","SHORT_BAR"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.004251978,'{}',NULL,FALSE,FALSE,NULL),
('2QMNEX5fOg-yvtZj','Skullcrusher w/ Leg Lower','Skullcrusher w/ Leg Lower',NULL,'ARMS','{"ARMS","CORE"}','{"core","triceps"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000101965,'{}',NULL,FALSE,FALSE,NULL),
('0-tIvRECyssMov48','SL Bent Over SA Row','SL Bent Over SA Row',NULL,'BACK','{"BACK","CORE","LEGS"}','{"calves","core","glutes","hamstrings","upper_back"}','{"HANDLES"}','row','unilateral','neutral',NULL,'DOUBLE',NULL,0.000122359,'{}',NULL,FALSE,FALSE,NULL),
('63RCSAdVrlM9duzB','SL Bicycle Crunch','SL Bicycle Crunch',NULL,'CORE','{"CORE"}','{"obliques"}','{"BENCH","STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('0Oh0_lqI38McSWPi','SL Calf Raise','SL Calf Raise',NULL,'LEGS','{"LEGS"}','{"calves"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('xnbdoyEux011kWzD','SL Glute Bridge','SL Glute Bridge (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000081572,'{}',NULL,FALSE,FALSE,NULL),
('q_tsQBgzlUhVBraK','SL Glute Bridge','SL Glute Bridge (Short Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000152948,'{}',NULL,FALSE,FALSE,NULL),
('EoGrn0BZRVtKl8sH','SL Glute Bridge','SL Glute Bridge (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BELT"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000081572,'{}',NULL,FALSE,FALSE,NULL),
('FmExLcwG_aL35qZQ','SL Glute Bridge','SL Glute Bridge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000112162,'{}',NULL,FALSE,FALSE,NULL),
('shp7LbPRawwkU2Ct','SL Hamstring Curl','SL Hamstring Curl (Straps)',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"STRAPS"}','hamstring_curl','unilateral',NULL,NULL,'DOUBLE',NULL,0.002436985,'{}',NULL,FALSE,FALSE,NULL),
('a6da0305-9a19-4314-85d7-0275cd5c99ce','SL Hamstring Curl','SL Hamstring Curl (Bench)',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"BENCH","STRAPS"}','hamstring_curl','unilateral',NULL,NULL,'DOUBLE',NULL,0.003232319,'{}',NULL,FALSE,FALSE,NULL),
('bFiC9iuNTVSZp0v9','SL Hip Thrust','SL Hip Thrust',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('l-XYYcr1wOlMnbr3','SL Hip Thrust','SL Hip Thrust (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BELT","BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000163145,'{}',NULL,FALSE,FALSE,NULL),
('I6HAxWzI9ZrdIS2v','SL Hip Thrust','SL Hip Thrust (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BENCH","SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('WK8z78u6e_ebgXco','SL Hip Thrust','SL Hip Thrust (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"BAR","BENCH"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000061179,'{}',NULL,FALSE,FALSE,NULL),
('kGipmvnqsTQp37D3','SL Leg Lower','SL Leg Lower',NULL,'CORE','{"CORE"}','{"obliques"}','{"BENCH","STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000091769,'{}',NULL,FALSE,FALSE,NULL),
('_id7xcXvZ0WJ173d','SL RDL w/ Knee Raise','SL RDL w/ Knee Raise (Handles)',NULL,'LEGS','{"LEGS"}','{"core","glutes","hamstrings"}','{"HANDLES"}','unilateral_leg','unilateral','pronated',NULL,'DOUBLE',NULL,0.000040786,'{"SL Romanian Deadlift"}',NULL,FALSE,FALSE,NULL),
('df475766-0c7a-45a1-8212-9ebacf9f69cc','SL RDL w/ Knee Raise','SL RDL w/ Knee Raise (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000377273,'{}',NULL,FALSE,FALSE,NULL),
('fIVIgFH6UKrNX-DI','SL Romanian Deadlift','SL Romanian Deadlift (Rope)',NULL,'BACK','{"BACK","LEGS"}','{"calves","glutes","hamstrings","lats"}','{"ROPE"}','deadlift','unilateral','neutral',NULL,'DOUBLE',NULL,0.000489436,'{}',NULL,FALSE,FALSE,NULL),
('777a17b2-3c89-43b9-8083-3e977465f4f1','SL Romanian Deadlift','SL Romanian Deadlift (Handles)',NULL,'BACK','{"BACK","LEGS"}','{"calves","glutes","hamstrings","lats"}','{"HANDLES"}','deadlift','unilateral',NULL,NULL,'DOUBLE',NULL,0.001091035,'{}',NULL,FALSE,FALSE,NULL),
('nxOOrX_rqICx37Ck','SL Romanian Deadlift','SL Romanian Deadlift (Handles)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"HANDLES"}','unilateral_leg','unilateral','pronated',NULL,'DOUBLE',NULL,0.000917693,'{"SL RDL"}',NULL,FALSE,FALSE,NULL),
('2c46a233-e244-4ef1-9d58-7f9756b66b17','SL Romanian Deadlift','SL Romanian Deadlift (Bar)',NULL,'BACK','{"BACK","LEGS"}','{"calves","glutes","hamstrings","lats"}','{"BAR"}','deadlift','unilateral',NULL,NULL,'DOUBLE',NULL,0.000265111,'{}',NULL,FALSE,FALSE,NULL),
('j5I0gGo62Enu3-1G','SL Romanian Deadlift','SL Romanian Deadlift (Short Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000693368,'{"SL RDL","Single Leg Deadlift","Single Leg RDL"}',NULL,FALSE,FALSE,NULL),
('YhHbs1xQZAJ_r9s2','SL Stability Plank','SL Stability Plank',NULL,'CORE','{"CORE","LEGS","SHOULDERS"}','{"core","glutes","hamstrings","quads","shoulders"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000071376,'{"3 point Plank","Three point plank"}',NULL,FALSE,FALSE,NULL),
('Lsc31Al-HcGX8nzG','SL Step Downs','SL Step Downs',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{"BELT","BENCH"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.00032629,'{}',NULL,FALSE,FALSE,NULL),
('05d704f1-71c4-461e-b7e0-ba2cd9b3d8a3','Snatch Grip Deadlift','Snatch Grip Deadlift',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","lower_back","traps","upper_back"}','{"BAR"}','deadlift','bilateral',NULL,NULL,'DOUBLE',NULL,0.000275307,'{}',NULL,FALSE,FALSE,NULL),
('uM1tv2msElnNoyCW','Snatch Grip RDL','Snatch Grip RDL',NULL,'BACK','{"BACK","LEGS"}','{"hamstrings","lats"}','{"BAR"}','deadlift','bilateral','pronated',NULL,'DOUBLE',NULL,0.000316094,'{"Snatch Grip Romanian deadlift","Romanian Deadlift","Wide Grip Romanian Deadlift"}',NULL,FALSE,FALSE,NULL),
('KvFDpZk01y-puixj','Spiderman Plank','Spiderman Plank',NULL,'CORE','{"CORE","LEGS","SHOULDERS"}','{"core","glutes","quads","shoulders"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000142752,'{}',NULL,FALSE,FALSE,NULL),
('0cc73224-1bc9-4fe5-acb2-6d4ae44b1e5e','Spiderman Push Up','Spiderman Push Up',NULL,'ARMS','{"ARMS","CHEST","CORE","LEGS","SHOULDERS"}','{"chest","core","glutes","quads","shoulders","triceps"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('4de6152d-5724-423b-a4c6-6bc1e53b3b5d','Split Stance Deficit RDL','Split Stance Deficit RDL',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","upper_back"}','{"BAR"}','deadlift','unilateral',NULL,NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,FALSE,FALSE,NULL),
('Edxi6ebsRFimTfmm','Split Stance RDL','Split Stance RDL (Handles)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","upper_back"}','{"HANDLES"}','deadlift','unilateral',NULL,NULL,'DOUBLE',NULL,0.001774206,'{}',NULL,FALSE,FALSE,NULL),
('YkG1gsqDzXM_ma1s','Split Stance RDL','Split Stance RDL (Short Bar)',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","upper_back"}','{"SHORT_BAR"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000734154,'{}',NULL,FALSE,FALSE,NULL),
('GZqCuZGp0j1YMay7','Split Stance RDL','Split Stance RDL (Bar)',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"BAR"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.000193735,'{"B-Stance RDL","Kickstand RDL","Romanian Deadlift"}',NULL,FALSE,FALSE,NULL),
('7cNbjwbM68LMD1zm','Split Stance RDL (SC)','Split Stance RDL (SC)',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000132555,'{"B-Stance RDL"}',NULL,FALSE,FALSE,NULL),
('eMXKtfHJkFBUYwmv','Split Stance RDL to Bicep Curl','Split Stance RDL to Bicep Curl',NULL,'ARMS','{"ARMS","BACK","LEGS"}','{"biceps","glutes","hamstrings","lats","upper_back"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000397667,'{}',NULL,FALSE,FALSE,NULL),
('Day2H5olhshxManX','Split Stance RDL to Row','Split Stance RDL to Row',NULL,'BACK','{"BACK","LEGS"}','{"hamstrings","lats"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{"B-Stance RDL"}',NULL,FALSE,FALSE,NULL),
('2e776d93-ec48-440e-bd91-09f045444b86','Split Stance RDL to SA Row','Split Stance RDL to SA Row',NULL,'BACK','{"BACK","LEGS"}','{"glutes","hamstrings","lats","upper_back"}','{"HANDLES"}','row','unilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('UjIGHxCav-lS9B2I','Squat','Squat',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000407863,'{}',NULL,FALSE,FALSE,NULL),
('lpnNPw86Vud67vWQ','Squat','Squat (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BELT"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.006107757,'{"Belt Squat"}',NULL,FALSE,FALSE,NULL),
('FTqSkLzs3YDdHDZp','Squat & Press','Squat & Press',NULL,'ARMS','{"ARMS","BACK","LEGS","SHOULDERS"}','{"glutes","hamstrings","quads","triceps","upper_back"}','{"HANDLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000377273,'{}',NULL,TRUE,FALSE,NULL),
('UBFwv3lY_NxDFxyl','Squat In & Out Jumps','Squat In & Out Jumps',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('mce7nVs-x3IuV5B4','Squat Jumps','Squat Jumps',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000224324,'{}',NULL,FALSE,FALSE,NULL),
('rek0xEgUeQ1XDOrB','Squat Jumps w/ Heel Tap','Squat Jumps w/ Heel Tap',NULL,'LEGS','{"LEGS"}','{"calves","glutes","hamstrings","quads"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('l8SH5y7rpXyMCwJj','Squat Pulses','Squat Pulses (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000101965,'{}',NULL,FALSE,FALSE,NULL),
('a_Viip-xwcvmhFYZ','Squat Pulses','Squat Pulses (Bar)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BAR","GREY_CABLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('9R_5XmjH0HFRESEp','Squat Pulses','Squat Pulses (Handles)',NULL,'LEGS','{"LEGS"}','{"quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000428256,'{"Partial Squat"}',NULL,FALSE,FALSE,NULL),
('bbpzNlEcQt-lOE-3','Squat to Bicep Curl','Squat to Bicep Curl',NULL,'ARMS','{"ARMS","CORE","LEGS"}','{"biceps","core","glutes","hamstrings","quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000214128,'{}',NULL,FALSE,FALSE,NULL),
('499408ab-0925-4aad-a78c-3ea8af23e10c','Squat to Calf Raise','Squat to Calf Raise (Handles)',NULL,'LEGS','{"LEGS"}','{"calves","quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00038747,'{}',NULL,FALSE,FALSE,NULL),
('QwsF6IvJyZYOfcIa','Squat to Calf Raise','Squat to Calf Raise (Bar)',NULL,'LEGS','{"LEGS"}','{"calves","quads"}','{"BAR","GREY_CABLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000203931,'{}',NULL,FALSE,FALSE,NULL),
('pyLiwJXDq4cyZC80','Squat to Shrug','Squat to Shrug',NULL,'BACK','{"BACK","LEGS"}','{"glutes","quads","traps"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000265111,'{}',NULL,FALSE,FALSE,NULL),
('_MrWIoBSj3TG4mwH','Squat to Sumo Squat Pulse','Squat to Sumo Squat Pulse',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('aea9a7c6-e02f-46b5-8440-1b38eb5c0e7f','Squat to Wood Chop','Squat to Wood Chop',NULL,'CORE','{"CORE","LEGS","SHOULDERS"}','{"core","quads","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000989069,'{}',NULL,FALSE,FALSE,NULL),
('VHQJmOU_IkMi5Ywu','Squat w/ Cross Knee Drive','Squat w/ Cross Knee Drive',NULL,'CORE','{"CORE","LEGS"}','{"core","quads"}','{}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000020393,'{}',NULL,TRUE,FALSE,NULL)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name, muscle_group=EXCLUDED.muscle_group, muscle_groups=EXCLUDED.muscle_groups, muscles=EXCLUDED.muscles, equipment=EXCLUDED.equipment, movement=EXCLUDED.movement, sidedness=EXCLUDED.sidedness, grip=EXCLUDED.grip, grip_width=EXCLUDED.grip_width, popularity=EXCLUDED.popularity, aliases=EXCLUDED.aliases, archived=EXCLUDED.archived, updated_at=NOW();

INSERT INTO exercise_catalog (id, name, display_name, description, muscle_group, muscle_groups, muscles, equipment, movement, sidedness, grip, grip_width, default_cable_config, min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom, user_id) VALUES
('HS1B9-gN0IArgAcl','Standing 45 Degree Kickback','Standing 45 Degree Kickback',NULL,'LEGS','{"LEGS"}','{"abductors","glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.00035688,'{}',NULL,FALSE,FALSE,NULL),
('de57db79-9796-4c6b-b0b2-4487ea55db10','Standing Abduction','Standing Abduction',NULL,'LEGS','{"LEGS"}','{"abductors","glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.001213394,'{}',NULL,FALSE,FALSE,NULL),
('ErNIiRrsQiSS94Mr','Standing Cable Flys','Standing Cable Flys',NULL,'CHEST','{"CHEST"}','{}','{"HANDLES"}','fly',NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('PfDaDszTwYX2Kh0O','Standing Glute Kickback','Standing Glute Kickback',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"STRAPS"}','glute_accessory','unilateral',NULL,NULL,'DOUBLE',NULL,0.001243984,'{}',NULL,FALSE,FALSE,NULL),
('qd08x4cngup1H1BO','Standing Hamstring Curl','Standing Hamstring Curl (Straps)',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"STRAPS"}','hamstring_curl','unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('2G-D8vn2pvW5wVMi','Standing Hamstring Curl','Standing Hamstring Curl (Straps)',NULL,'LEGS','{"LEGS"}','{"hamstrings"}','{"STRAPS"}','hamstring_curl','unilateral',NULL,NULL,'DOUBLE',NULL,0.000989069,'{}',NULL,FALSE,FALSE,NULL),
('ahexn5IsQx-d-aLy','Standing Rotation','Standing Rotation',NULL,'CORE','{"CORE"}','{"core","obliques"}','{"ROPE"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000764744,'{}',NULL,FALSE,FALSE,NULL),
('IuVCdM4pnGdd6w8i','Standing SL Hip Flexor March','Standing SL Hip Flexor March',NULL,'LEGS','{"LEGS"}','{"quads"}','{"STRAPS"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000611795,'{}',NULL,FALSE,FALSE,NULL),
('UIHu64uUJNkwZnK-','Standing Upward Twist','Standing Upward Twist',NULL,'ARMS','{"ARMS","CORE","SHOULDERS"}','{"biceps","core","shoulders"}','{"HANDLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('1W_0cwjBVboBtCcY','Step Downs','Step Downs',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BENCH","HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000550615,'{}',NULL,FALSE,FALSE,NULL),
('4bC9G_fnp_gz3Fvw','Step Overs','Step Overs',NULL,'LEGS','{"LEGS"}','{"hamstrings","quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000061179,'{"Side Shuffle","V-Form Shuffle","Steps","Lateral Shuffle"}',NULL,FALSE,FALSE,NULL),
('JdIQX_Biu8A3QsUU','Step Up w/ Knee Raise','Step Up w/ Knee Raise',NULL,'LEGS','{"LEGS"}','{"quads"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000244718,'{}',NULL,FALSE,FALSE,NULL),
('s9YUIJ4xLcDDr9pS','Step up w/ Knee Raise','Step up w/ Knee Raise (Bench)',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"BENCH","HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000346684,'{}',NULL,FALSE,FALSE,NULL),
('NmYpPDrf9XstKbEH','Stiff Leg Deadlift','Stiff Leg Deadlift',NULL,'BACK','{"BACK","LEGS"}','{"hamstrings","lower_back"}','{"BAR"}','deadlift','bilateral',NULL,NULL,'DOUBLE',NULL,0.001152214,'{}',NULL,FALSE,FALSE,NULL),
('a827a68f-c185-45bf-bbbf-9ca53c4cc132','Suitcase Deadlift','Suitcase Deadlift',NULL,'BACK','{"BACK","LEGS"}','{"hamstrings","lower_back"}','{"HANDLES"}','deadlift','bilateral',NULL,NULL,'DOUBLE',NULL,0.005791663,'{}',NULL,FALSE,FALSE,NULL),
('b258892d-58d5-4bfe-a8b4-3cb9e8298408','Suitcase Deficit Reverse Lunge','Suitcase Deficit Reverse Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.001539685,'{}',NULL,FALSE,FALSE,NULL),
('817f10d5-57b2-44be-b9f6-0ad647edd825','Suitcase Sit to Stand','Suitcase Sit to Stand',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BENCH","HANDLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000336487,'{}',NULL,FALSE,FALSE,NULL),
('93f5a3ce-5d93-4b68-b001-f1fdf1d9ec90','Suitcase SL RDL','Suitcase SL RDL',NULL,'BACK','{"BACK","LEGS"}','{"hamstrings","lower_back"}','{"HANDLES"}','unilateral_leg','unilateral',NULL,NULL,'DOUBLE',NULL,0.000101965,'{}',NULL,FALSE,FALSE,NULL),
('6PVJLGhvozpELKtc','Suitcase Squat','Suitcase Squat','1. Setup: Stand with your feet shoulder-width apart, holding a handle in each hand. Let your arms hang down by your sides with your palms facing inward.

2. Positioning: Keep your back straight, chest up, and engage your core for stability.

3. Squatting: Initiate the squat by pushing your hips back and bending your knees. Lower your body down, as if you''re sitting back into an imaginary chair.

4. Depth: Descend until your thighs are at least parallel to the ground, or go lower if your mobility allows comfortably. Your knees should track in line with your toes.

5. Rising: Push through your heels and extend your hips and knees simultaneously to return to the starting position. Keep your chest up throughout the movement.','LEGS','{"LEGS"}','{"glutes","quads"}','{"HANDLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.013031242,'{}',NULL,FALSE,FALSE,NULL),
('78e6d11d-cda2-49d6-aaf7-f3ea2255f1ae','Sumo Back Squat','Sumo Back Squat',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BAR","GREY_CABLES"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.001060445,'{"Back Squat"}',NULL,FALSE,FALSE,NULL),
('CJWWuqMMu0_BvQ2R','Sumo Belt Squat','Sumo Belt Squat',NULL,'LEGS','{"LEGS"}','{"glutes","quads"}','{"BELT"}','squat','bilateral',NULL,NULL,'DOUBLE',NULL,0.000723957,'{}',NULL,FALSE,FALSE,NULL),
('c555d400-cd2d-4439-af8d-d98140fef664','Sumo Deadlift','Sumo Deadlift','1. Setup: Stand with your feet wider than shoulder-width apart, with your toes pointing out at an angle. The middle of your feet should line up with the cable inlets.

2. Grip: Bend at your hips and knees to reach down and grasp the bar with both hands. Your grip should be inside your knees, with your palms facing your body or using a mixed grip.

3. Positioning: Keep your back straight, chest up, and engage your core for stability. Your hips should be lower than your shoulders, and your shins should be as vertical as possible. The bar should be positioned over the middle of your feet.

4. Lifting: Push through your whole foot and stand up, extending your hips and knees simultaneously. Keep the bar close to your body as you lift.

5. Squeezing: At the top of the movement, stand tall with your hips fully extended and your shoulders back.

6. Lowering: Lower the bar back down to the floor by reversing the movement, pushing your hips back first, and then bending your knees.','BACK','{"BACK","LEGS"}','{"hamstrings","lats","lower_back"}','{"BAR"}','deadlift','bilateral',NULL,NULL,'DOUBLE',NULL,0.002253446,'{}',NULL,FALSE,FALSE,NULL),
('5f7ab6f4-06b7-413b-9d4a-1e7aeb615cb3','Sumo SA High Pull','Sumo SA High Pull',NULL,'BACK','{"BACK","LEGS","SHOULDERS"}','{"quads","shoulders","traps"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000234521,'{}',NULL,FALSE,FALSE,NULL),
('_lhY8AZnh7IYX_l_','Superman','Superman (Bench)',NULL,'BACK','{"BACK"}','{"lats","lower_back","traps","upper_back"}','{"BENCH","HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000050982,'{}',NULL,FALSE,FALSE,NULL),
('JH1eQMPX24Aggl6o','Superman','Superman',NULL,'BACK','{"BACK"}','{"lats","lower_back","traps","upper_back"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000142752,'{}',NULL,FALSE,FALSE,NULL),
('Fh4p-rXSrLZ7MajT','Superman Wipers','Superman Wipers',NULL,'BACK','{"BACK"}','{"lower_back","upper_back"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000010196,'{}',NULL,FALSE,FALSE,NULL),
('0L6wSUIpGi8G4fS8','Supinated Wrist Curls','Supinated Wrist Curls',NULL,'ARMS','{"ARMS"}','{"forearms"}','{"SHORT_BAR"}',NULL,'bilateral','supinated',NULL,'DOUBLE',NULL,0.00173342,'{}',NULL,FALSE,FALSE,NULL),
('ecsCnRRC5buTy-0x','Supine Spinal Twist','Supine Spinal Twist',NULL,'BACK','{"BACK"}','{"lower_back","upper_back"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('s2_RiMfu2paVmxSg','Table Top','Table Top',NULL,'CORE','{"CORE","LEGS","SHOULDERS"}','{"core","glutes","shoulders"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,FALSE,FALSE,NULL),
('PjXBcvDnFVqkww-H','Table Top Hip Thrust','Table Top Hip Thrust (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('L5NB_9_KF9CHdWpE','Table Top Hip Thrust','Table Top Hip Thrust (Belt)',NULL,'LEGS','{"LEGS"}','{"glutes"}','{"BELT"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000040786,'{}',NULL,FALSE,FALSE,NULL),
('YSMsQ1ArsUOs488E','Table Top SA Press','Table Top SA Press',NULL,'CHEST','{"CHEST","CORE","SHOULDERS"}','{"chest","core","obliques","shoulders"}','{"HANDLES"}','shoulder_isolation','unilateral',NULL,NULL,'DOUBLE',NULL,0.000061179,'{}',NULL,FALSE,FALSE,NULL),
('aOLnKMls1AKS-JE7','Three Stance Calf Raise','Three Stance Calf Raise',NULL,'LEGS','{"LEGS"}','{"calves"}','{"BAR","BLACK_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000091769,'{}',NULL,FALSE,FALSE,NULL),
('QXyK0ML4TD5tlPxl','Three Stance Squat','Three Stance Squat',NULL,'LEGS','{"LEGS"}','{"abductors","glutes","quads"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000122359,'{}',NULL,FALSE,FALSE,NULL),
('H1PNVQBZm4f9KXb3','Thruster','Thruster (Bar)',NULL,'LEGS','{"LEGS","SHOULDERS"}','{"quads","shoulders"}','{"BAR","BLACK_CABLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.001131821,'{}',NULL,FALSE,FALSE,NULL),
('260fca84-232f-4e9a-aa9c-afe34abacff3','Thruster','Thruster (Handles)',NULL,'LEGS','{"LEGS","SHOULDERS"}','{"quads","shoulders"}','{"HANDLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.001264377,'{"Squat and Press","Squat & Press","Squat to press"}',NULL,FALSE,FALSE,NULL),
('OQZaXBAEWO8Wk4Yt','Toe Touches','Toe Touches',NULL,'CORE','{"CORE"}','{"core","obliques"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000234521,'{}',NULL,FALSE,FALSE,NULL),
('yd_8huuaiTgyhhyA','Torso Twist','Torso Twist',NULL,'CORE','{"CORE"}','{}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('gGIzIbB5DSuzyKd5','Trap Bar Deadlift','Trap Bar Deadlift',NULL,'BACK','{"BACK","LEGS"}','{"hamstrings","lats","lower_back","upper_back"}','{"HANDLES"}','deadlift','bilateral','neutral',NULL,'DOUBLE',NULL,0.001662044,'{}',NULL,FALSE,FALSE,NULL),
('rSP8JKeoDxexC_Gu','Tricep Dip','Tricep Dip',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BELT","BENCH"}','tricep_extension','bilateral',NULL,NULL,'DOUBLE',NULL,0.00035688,'{}',NULL,FALSE,FALSE,NULL),
('YNf-y04K0ENtDNi0','Tricep Dips','Tricep Dips',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.00128477,'{}',NULL,FALSE,FALSE,NULL),
('fs5XmqhpN9Mk9mnF','Tricep Kick Back','Tricep Kick Back (Handles)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','unilateral','neutral',NULL,'DOUBLE',NULL,0.001570274,'{}',NULL,FALSE,FALSE,NULL),
('IrPf7PCbwEcuJEG5','Tricep Kick Back','Tricep Kick Back (Handles)',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"HANDLES"}','tricep_extension','unilateral','pronated',NULL,'DOUBLE',NULL,0.002651113,'{}',NULL,FALSE,FALSE,NULL),
('85c0aa8d-d0e4-4ba0-a802-a557affd1116','Tricep Kick Back - Supported','Tricep Kick Back - Supported',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"BENCH","HANDLES"}','tricep_extension','unilateral','neutral',NULL,'DOUBLE',NULL,0.00215148,'{}',NULL,FALSE,FALSE,NULL),
('ulSq4f5g8O1DjESl','Tricep Push Up','Tricep Push Up',NULL,'ARMS','{"ARMS","CHEST","CORE"}','{"chest","core","triceps"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000122359,'{}',NULL,FALSE,FALSE,NULL),
('BUxuV42l6oolZVde','Tricep Pushdown','Tricep Pushdown',NULL,'ARMS','{"ARMS"}','{"triceps"}','{"SHORT_BAR"}','tricep_extension','bilateral','pronated',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('9tm2G1W0uf8y-77f','Tricep Stretch','Tricep Stretch',NULL,'General','{}','{}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('9KFcQvBQ1y4B4gC3','Tuck Jump','Tuck Jump',NULL,'LEGS','{"LEGS"}','{"quads"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,FALSE,FALSE,NULL),
('513b8b5b-5315-4510-87c6-04df95a51053','Upright Row','Upright Row (Handles)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.002100497,'{}',NULL,FALSE,FALSE,NULL),
('6Q9E-cUbwO7mhAbG','Upright Row','Upright Row (Rope)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps"}','{"ROPE"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001845582,'{}',NULL,FALSE,FALSE,NULL),
('dolYIaKI1o1wn_Oh','Upright Row','Upright Row (Short Bar)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001937352,'{}',NULL,FALSE,FALSE,NULL),
('7d141cfb-fdde-4320-8553-1e03f6b4e9bd','Upright Row','Upright Row (Bar)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps"}','{"BAR","BLACK_CABLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.003007994,'{}',NULL,FALSE,FALSE,NULL),
('ravxz3gHSUs8t6Ck','Upright Row (SC)','Upright Row (SC)',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000285504,'{}',NULL,FALSE,FALSE,NULL),
('ApnN1oyGDK05fAQS','Upright Row to Shoulder Press','Upright Row to Shoulder Press',NULL,'BACK','{"BACK","SHOULDERS"}','{"shoulders","traps"}','{"BAR","BLACK_CABLES"}',NULL,'bilateral','pronated',NULL,'DOUBLE',NULL,0.000316094,'{}',NULL,FALSE,FALSE,NULL),
('VH0wZk124BuuS99O','Upright Shoulder External Rotator','Upright Shoulder External Rotator',NULL,'BACK','{"BACK","CORE","SHOULDERS"}','{}','{"GREY_CABLES","HANDLES"}','shoulder_isolation',NULL,NULL,NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('uHAiPY44IO7TgZdK','V-Sit Press','V-Sit Press',NULL,'CHEST','{"CHEST","CORE","SHOULDERS"}','{"chest","core","obliques","shoulders"}','{"HANDLES"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.001193001,'{}',NULL,FALSE,FALSE,NULL),
('V0HUsN-fjhORkR8N','V-Tucks','V-Tucks',NULL,'CORE','{"CORE"}','{"core"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000061179,'{}',NULL,FALSE,FALSE,NULL),
('8hbXFqffiMF_8D8R','V-Tucks','V-Tucks (Bench)',NULL,'CORE','{"CORE"}','{"core"}','{"BENCH","STRAPS"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000224324,'{}',NULL,FALSE,FALSE,NULL),
('X66uNUrW-S5ZoC6m','V-Up','V-Up',NULL,'CORE','{"CORE"}','{"core"}','{}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000061179,'{}',NULL,FALSE,FALSE,NULL),
('RBxmDZFAONyv_ovt','Walking Hamstring Scoop','Walking Hamstring Scoop',NULL,'LEGS','{"LEGS"}','{"calves","hamstrings"}','{}',NULL,'alternating',NULL,NULL,'DOUBLE',NULL,0.000030589,'{}',NULL,FALSE,FALSE,NULL),
('DAdfpK3ekrgLllmx','Wide Grip Bicep Curl','Wide Grip Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BAR","BLACK_CABLES"}','bicep_curl','bilateral','supinated',NULL,'DOUBLE',NULL,0.000611795,'{}',NULL,FALSE,FALSE,NULL),
('GRL8oT9WtaRKez73','Wide Grip Pronated Bicep Curl','Wide Grip Pronated Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BAR","BLACK_CABLES"}','bicep_curl','bilateral','pronated',NULL,'DOUBLE',NULL,0.000234521,'{}',NULL,FALSE,FALSE,NULL),
('zW-IfyPm-g0UPkCi','Wide Grip Pulldown','Wide Grip Pulldown',NULL,'BACK','{"BACK"}','{"lats","upper_back"}','{"BAR"}','row','bilateral','pronated',NULL,'DOUBLE',NULL,0,'{}',NULL,TRUE,FALSE,NULL),
('MR2bLPxMweqfJZhE','Wide Grip Supinated Bicep Curl','Wide Grip Supinated Bicep Curl',NULL,'ARMS','{"ARMS"}','{"biceps"}','{"BAR","BLACK_CABLES"}',NULL,'bilateral','supinated',NULL,'DOUBLE',NULL,0.000214128,'{}',NULL,FALSE,FALSE,NULL),
('f9uw1qCFUhNlrPoj','Windmill','Windmill (Handles)',NULL,'CORE','{"CORE","SHOULDERS"}','{}','{"HANDLES"}',NULL,NULL,NULL,NULL,'DOUBLE',NULL,0.000305897,'{}',NULL,TRUE,FALSE,NULL),
('JgArpiAO2lQCWput','Windmill','Windmill (Handles)',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"HANDLES"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.00080553,'{}',NULL,FALSE,FALSE,NULL),
('QK0V6VzQMtdY8aWg','Wood Chop','Wood Chop',NULL,'CORE','{"CORE","SHOULDERS"}','{"core","obliques","shoulders"}','{"ROPE"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000571009,'{}',NULL,FALSE,FALSE,NULL),
('pQ1R9GSmQ_Bkri40','World''s Greatest Stretch','World''s Greatest Stretch',NULL,'BACK','{"BACK","CORE","LEGS","SHOULDERS"}','{"core","quads","shoulders","upper_back"}','{}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000183538,'{}',NULL,FALSE,FALSE,NULL),
('ljmgYw_wMHGzXSTY','Z-Press','Z-Press',NULL,'SHOULDERS','{"SHOULDERS"}','{"shoulders"}','{"HANDLES"}','shoulder_press','bilateral',NULL,NULL,'DOUBLE',NULL,0.000173342,'{}',NULL,FALSE,FALSE,NULL),
('7R8bNkUpYu95YDms','Zercher Good Morning','Zercher Good Morning',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000163145,'{}',NULL,FALSE,FALSE,NULL),
('6pv-zwP4QxiDWcgV','Zercher Lunge','Zercher Lunge',NULL,'LEGS','{"LEGS"}','{"glutes","hamstrings","quads"}','{"SHORT_BAR"}',NULL,'unilateral',NULL,NULL,'DOUBLE',NULL,0.000265111,'{}',NULL,FALSE,FALSE,NULL),
('bGY-qHuQ4SSqd2lB','Zercher Squat','Zercher Squat',NULL,'LEGS','{"LEGS"}','{"quads"}','{"SHORT_BAR"}',NULL,'bilateral',NULL,NULL,'DOUBLE',NULL,0.000479239,'{}',NULL,FALSE,FALSE,NULL)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name, muscle_group=EXCLUDED.muscle_group, muscle_groups=EXCLUDED.muscle_groups, muscles=EXCLUDED.muscles, equipment=EXCLUDED.equipment, movement=EXCLUDED.movement, sidedness=EXCLUDED.sidedness, grip=EXCLUDED.grip, grip_width=EXCLUDED.grip_width, popularity=EXCLUDED.popularity, aliases=EXCLUDED.aliases, archived=EXCLUDED.archived, updated_at=NOW();

