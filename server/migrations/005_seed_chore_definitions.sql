-- 005_seed_chore_definitions.sql

-- Add standard chore definitions if they do not exist
INSERT INTO chore_definitions (household_id, name, description)
SELECT 1, 'Bathroom Cleaning', 'Weekly deep cleaning and sanitization of shared bathrooms'
WHERE NOT EXISTS (
    SELECT 1 FROM chore_definitions WHERE household_id = 1 AND name = 'Bathroom Cleaning'
);

INSERT INTO chore_definitions (household_id, name, description)
SELECT 1, 'Sink/Wash-area Cleaning', 'Cleaning and unclogging common washbasin and counter areas'
WHERE NOT EXISTS (
    SELECT 1 FROM chore_definitions WHERE household_id = 1 AND name = 'Sink/Wash-area Cleaning'
);

INSERT INTO chore_definitions (household_id, name, description)
SELECT 1, 'House Cleaning', 'Sweeping and mopping living room, dining area, and hallways'
WHERE NOT EXISTS (
    SELECT 1 FROM chore_definitions WHERE household_id = 1 AND name = 'House Cleaning'
);

INSERT INTO chore_definitions (household_id, name, description)
SELECT 1, 'Water Duty', 'Checking overhead tank levels and turning motor on/off'
WHERE NOT EXISTS (
    SELECT 1 FROM chore_definitions WHERE household_id = 1 AND name = 'Water Duty'
);
