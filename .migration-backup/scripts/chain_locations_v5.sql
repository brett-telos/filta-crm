BEGIN;
INSERT INTO accounts(id,company_name,territory,account_status,nca_flag,lead_source,service_profile,address_line_1,city,state,zip,county,website,phone,phone_raw,filta_record_id,sales_funnel_stage,sales_funnel_stage_changed_at,created_at,updated_at)
SELECT gen_random_uuid(),'Beef O''Brady''s - Titusville','space_coast'::territory,'prospect'::account_status,false,'other'::lead_source,'{}'::jsonb,'3455 Cheney Hwy','Titusville','FL','32780','Brevard','https://www.beefobradys.com/titusville','(321) 567-4271','321-567-4271','597207d5-6422-33bf-4eeb-68543eec69d5','qualified'::pipeline_stage,now(),now(),now()
WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.filta_record_id='597207d5-6422-33bf-4eeb-68543eec69d5' AND a.deleted_at IS NULL);
INSERT INTO accounts(id,company_name,territory,account_status,nca_flag,lead_source,service_profile,address_line_1,city,state,zip,county,website,phone,phone_raw,filta_record_id,sales_funnel_stage,sales_funnel_stage_changed_at,created_at,updated_at)
SELECT gen_random_uuid(),'Beef O''Brady''s - De Land','fun_coast'::territory,'prospect'::account_status,false,'other'::lead_source,'{}'::jsonb,'2667 S Woodland Blvd','De Land','FL','32720','Volusia',NULL,'(386) 822-4633','386-822-4633','2df2f042-9599-3d8c-04b3-520bbe794c18','qualified'::pipeline_stage,now(),now(),now()
WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.filta_record_id='2df2f042-9599-3d8c-04b3-520bbe794c18' AND a.deleted_at IS NULL);
INSERT INTO contacts(id,account_id,first_name,last_name,full_name,is_primary,created_at,updated_at)
SELECT gen_random_uuid(),a.id,'Joe','Dolyak','Joe Dolyak',true,now(),now()
FROM accounts a WHERE a.filta_record_id='2df2f042-9599-3d8c-04b3-520bbe794c18' AND a.deleted_at IS NULL
AND NOT EXISTS(SELECT 1 FROM contacts c WHERE c.account_id=a.id AND c.is_primary AND c.deleted_at IS NULL);
INSERT INTO accounts(id,company_name,territory,account_status,nca_flag,lead_source,service_profile,address_line_1,city,state,zip,county,website,phone,phone_raw,filta_record_id,sales_funnel_stage,sales_funnel_stage_changed_at,created_at,updated_at)
SELECT gen_random_uuid(),'Beef O''Brady''s - New Smyrna Beach','fun_coast'::territory,'prospect'::account_status,false,'other'::lead_source,'{}'::jsonb,'1610 S Dixie Fwy','New Smyrna Beach','FL','32168','Volusia','https://www.beefobradys.com/newsmyrnabeach','(386) 424-9292','386-424-9292','bb0fbb0b-adee-4544-9672-60da3c80a746','qualified'::pipeline_stage,now(),now(),now()
WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.filta_record_id='bb0fbb0b-adee-4544-9672-60da3c80a746' AND a.deleted_at IS NULL);
INSERT INTO contacts(id,account_id,first_name,last_name,full_name,is_primary,created_at,updated_at)
SELECT gen_random_uuid(),a.id,'Greg','Giles','Greg Giles',true,now(),now()
FROM accounts a WHERE a.filta_record_id='bb0fbb0b-adee-4544-9672-60da3c80a746' AND a.deleted_at IS NULL
AND NOT EXISTS(SELECT 1 FROM contacts c WHERE c.account_id=a.id AND c.is_primary AND c.deleted_at IS NULL);
INSERT INTO accounts(id,company_name,territory,account_status,nca_flag,lead_source,service_profile,address_line_1,city,state,zip,county,website,phone,phone_raw,filta_record_id,sales_funnel_stage,sales_funnel_stage_changed_at,created_at,updated_at)
SELECT gen_random_uuid(),'Chick-Fil-A - West Melbourne','space_coast'::territory,'prospect'::account_status,false,'other'::lead_source,'{}'::jsonb,'835 Palm Bay Rd NE','West Melbourne','FL','32904','Brevard','https://www.chick-fil-a.com','(321) 733-7110','321-733-7110','e3f2016b-1494-71a0-d0b7-52d420537063','qualified'::pipeline_stage,now(),now(),now()
WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.filta_record_id='e3f2016b-1494-71a0-d0b7-52d420537063' AND a.deleted_at IS NULL);
INSERT INTO contacts(id,account_id,first_name,last_name,full_name,is_primary,created_at,updated_at)
SELECT gen_random_uuid(),a.id,'Scott','Washburn','Mr. Scott Washburn',true,now(),now()
FROM accounts a WHERE a.filta_record_id='e3f2016b-1494-71a0-d0b7-52d420537063' AND a.deleted_at IS NULL
AND NOT EXISTS(SELECT 1 FROM contacts c WHERE c.account_id=a.id AND c.is_primary AND c.deleted_at IS NULL);
UPDATE accounts a SET
 address_line_1=COALESCE(NULLIF(a.address_line_1,''),'5675 N Atlantic Ave Ste 122'), city=COALESCE(NULLIF(a.city,''),'Cocoa Beach'),
 state=COALESCE(NULLIF(a.state,''),'FL'), zip=COALESCE(NULLIF(a.zip,''),'32931'), county=COALESCE(NULLIF(a.county,''),'Brevard'),
 phone=COALESCE(NULLIF(a.phone,''),'(321) 784-3843'), phone_raw=COALESCE(NULLIF(a.phone_raw,''),'321-784-3843'), updated_at=now()
WHERE left(a.id::text,8)='a3d2cbfb' AND a.deleted_at IS NULL;
INSERT INTO contacts(id,account_id,first_name,last_name,full_name,is_primary,created_at,updated_at)
SELECT gen_random_uuid(),a.id,'Veronica','Collins','Veronica Collins',true,now(),now()
FROM accounts a WHERE left(a.id::text,8)='a3d2cbfb' AND a.deleted_at IS NULL
AND NOT EXISTS(SELECT 1 FROM contacts c WHERE c.account_id=a.id AND c.is_primary AND c.deleted_at IS NULL);
\echo === NEW LOCATIONS ===
SELECT company_name, city, phone, website FROM accounts WHERE filta_record_id IN ('597207d5-6422-33bf-4eeb-68543eec69d5','2df2f042-9599-3d8c-04b3-520bbe794c18','bb0fbb0b-adee-4544-9672-60da3c80a746','e3f2016b-1494-71a0-d0b7-52d420537063') AND deleted_at IS NULL ORDER BY company_name;
COMMIT;
