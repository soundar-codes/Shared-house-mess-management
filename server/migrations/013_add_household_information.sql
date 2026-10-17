-- 013_add_household_information.sql
CREATE TABLE IF NOT EXISTS household_information (
    id SERIAL PRIMARY KEY,
    household_id INT UNIQUE REFERENCES households(id) ON DELETE CASCADE,
    address TEXT,
    landmark VARCHAR(255),
    pincode VARCHAR(20),
    google_maps_url TEXT,
    emergency_contacts JSONB DEFAULT '[]'::jsonb,
    wifi_ssid VARCHAR(100),
    wifi_password VARCHAR(100),
    house_rules TEXT,
    notes TEXT,
    updated_by VARCHAR(255) REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO household_information (household_id, address, landmark, pincode, wifi_ssid, wifi_password, emergency_contacts, house_rules, notes)
VALUES (
    1, 
    'Flat 402, Green Valley Enclave, 4th Cross Road', 
    'Near Metro Station & Fresh Mart Supermarket', 
    '560037', 
    'SharedHouse_5G', 
    'HousePeace@2026', 
    '[
        {"role": "House Owner / Landlord", "name": "Mr. Ramanathan", "phone": "+91 98450 12345"},
        {"role": "Electrician", "name": "Suresh Kumar", "phone": "+91 98401 54321"},
        {"role": "Plumber", "name": "Mani", "phone": "+91 97911 67890"},
        {"role": "Drinking Water Delivery", "name": "Aqua Springs", "phone": "+91 99402 33445"},
        {"role": "Nearby Hospital / Emergency", "name": "City Care Multi-Speciality", "phone": "080-23456789 / 108"}
    ]'::jsonb,
    '1. Cutoff for food cancellation is 11:00 PM IST daily.
2. Wash vessels promptly after each meal according to the weekly roster.
3. Turn off AC and geysers when leaving the room.
4. Keep main door locked at night.',
    'Common dustbin clearance happens every Tuesday & Friday morning.'
) ON CONFLICT (household_id) DO NOTHING;
