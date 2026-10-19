-- Sisters' coordinators: like campus pastors and the regional admin, but they only see female members.
-- centre_sister looks after one fellowship centre; regional_sister covers the whole region.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users DROP CONSTRAINT campus_pastor_needs_centre;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('regional_admin', 'campus_pastor', 'centre_sister', 'regional_sister'));
ALTER TABLE users ADD CONSTRAINT centre_roles_need_centre CHECK (role NOT IN ('campus_pastor', 'centre_sister') OR centre_id IS NOT NULL);
