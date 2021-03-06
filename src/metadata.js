var liburl = require('url'),
	util = require('./util.js'),
	db = require('./db.js'),
	perms = require('./perms.js');


function getAllMetadata(req,res,next)
{
	var id = parseInt(req.params.id, 16);
	perms.hasPerm(id, req.session.username, perms.READ, function(err,result)
	{
		if(err){
			console.error('Failed to check permissions:', err);
			res.status(500).send('DB error');
		}
		else if(!result){
			res.status(404).send('No asset with this ID');
		}
		else if( !result.permitted ){
			if(req.session.username)
				res.status(403).send('Asset does not allow unprivileged access');
			else
				res.status(401).send('Asset does not allow anonymous access');
		}
		else
		{
			db.queryAllResults('SELECT key, value, asset FROM Metadata WHERE id = $id', {$id: id},
				function(err,rows){
					if(err){
						console.error('Failed to fetch metadata:', err);
						res.status(500).send('DB error');
					}
					else
					{
						var meta = {
							'type': result.type,
							'permissions': req.query.permFormat === 'json' ? perms.unpackPerms(result.permissions) : result.permissions.toString(8),
							'user_name': result.user_name,
							'group_name': result.group_name,
							'created': result.created,
							'last_modified': result.last_modified,
							'size': result.size
						};

						for(var i=0; i<rows.length; i++){
							meta[rows[i].key] = rows[i].value !== null ? rows[i].value : 'asset:'+('00000000'+rows[i].asset.toString(16)).slice(-8);
						}

						res.json(meta);
					}
				}
			);
		}
	});
}

function getSomeMetadata(req,res,next)
{
	var id = parseInt(req.params.id, 16);
	var keys = req.params.fields.split('+');
	perms.hasPerm(id, req.session.username, perms.READ, function(err,result)
	{
		if(err){
			console.error('Failed to check permissions:', err);
			res.status(500).send('DB error');
		}
		else if(!result){
			res.status(404).send('No asset with this ID');
		}
		else if( !result.permitted ){
			if(req.session.username)
				res.status(403).send('Asset does not allow unprivileged access');
			else
				res.status(401).send('Asset does not allow anonymous access');
		}
		else
		{
			db.queryAllResults('SELECT key, value, asset FROM Metadata WHERE id = $id AND key IN ('+util.escapeValue(keys)+')', {$id: id, $key: req.params.field},
				function(err,rows)
				{
					if(err){
						console.error('Failed to get metadata:', err);
						res.status(500).send('DB error');
					}
					else if(keys.length === 1 && rows.length === 1 && rows[0].asset && !req.query.raw)
					{
						var origPath = liburl.parse( req.originalUrl ).pathname;
						var newPath = origPath.replace( new RegExp('[0-9A-Fa-f]{8}\/meta\/'+keys[0]+'$'), ('00000000'+rows[0].asset.toString(16)).slice(-8) );
						res.redirect(newPath);
					}
					else
					{
						var out = {};

						for(var i=0; i<rows.length; i++){
							out[ rows[i].key ] = rows[i].value !== null ? rows[i].value : 'asset:'+('00000000'+rows[i].asset.toString(16)).slice(-8);
						}

						for(var i=0; i<keys.length; i++){
							if( ['type','permissions','user_name','group_name','created','last_modified','size'].indexOf(keys[i]) > -1 )
							{
								if( keys[i] === 'permissions' ){
									if( req.query.permFormat === 'json' ){
										out[keys[i]] = perms.unpackPerms(result.permissions);
									}
									else {
										out[keys[i]] = result.permissions.toString(8);
									}
								}
								else {
									out[keys[i]] = result[keys[i]];
								}
							}
							else if( keys[i] === 'id' )
								out.id = req.params.id;
						}

						if( Object.keys(out).length === 0 )
							res.status(404).send('No metadata for this asset by that name');
						else if( Object.keys(out).length === 1 )
							res.send(out[keys[0]]);
						else
							res.json(out);
					}
				}
			);
		}
	});

	
}

function setMetadata(id, data, cb)
{
	delete data.type;
	delete data.permissions;
	delete data.user_name;
	delete data.group_name;
	delete data.created;
	delete data.last_modified;
	delete data.size;

	var inserts = [];
	var deletes = [];
	for(var i in data){
		var isAsset = /^asset:([A-Fa-f0-9]{8})$/.exec( data[i] );
		var assetId = isAsset ? parseInt(isAsset[1], 16) : null;

		if( data[i] === null )
			deletes.push(i);
		else {
			var value = isAsset ? null : typeof(data[i]) === 'string' ? data[i] : JSON.stringify(data[i]);
			inserts.push( [id, i, value, assetId ] );
		}
	}

	if( inserts.length === 0 && deletes.length === 0 )
		cb();
	else
	{
		db.queryNoResults('INSERT OR REPLACE INTO Metadata (id, key, value, asset) VALUES '+util.escapeValue(inserts), [], function(err)
		{
			if(err){
				cb(err);
			}
			else {
				//db.queryNoResults('DELETE FROM Metadata WHERE value = NULL AND asset = NULL', [], cb);
				db.queryNoResults('DELETE FROM Metadata WHERE id = ? AND key IN ('+util.escapeValue(deletes)+')', [id], cb);
			}
		});
	}
}

function setAllMetadata(req,res,next)
{
	var id = parseInt(req.params.id, 16);

	try {
		req.body = JSON.parse(req.body.toString());
	}
	catch(e){
		return res.status(400).send('Request body is malformed JSON');
	}

	perms.hasPerm(id, req.session.username, perms.WRITE, function(err,result)
	{
		if(err){
			console.error('Failed to check permissions:', err);
			res.status(500).send('DB error');
		}
		else if(!result){
			res.status(404).send('No asset with this ID');
		}
		else if( !result.permitted ){
			if(req.session.username)
				res.status(403).send('Asset does not allow unprivileged writes');
			else
				res.status(401).send('Asset does not allow anonymous writes');
		}
		else
		{
			setMetadata(id, req.body, function(err,result){
				if(err){
					console.error('Failed to set metadata:', err);
					res.status(500).send('DB error');
				}
				else {
					res.sendStatus(200);
				}
			});
		}
	});

}

function setSomeMetadata(req,res,next)
{
	var id = parseInt(req.params.id, 16);

	if( ['permissions','group_name','type','user_name','created','last_modified','size'].indexOf(req.params.field) > -1 ){
		res.status(403).send('Cannot directly modify protected field');
	}
	else if( req.body.length === 0 ){
		res.status(400).send('New metadata value not specified');
	}
	else
	{
		perms.hasPerm(id, req.session.username, perms.WRITE, function(err,result)
		{
			if(err){
				console.error('Failed to check permissions:', err);
				res.status(500).send('DB error');
			}
			else if(!result){
				res.status(404).send('No asset with this ID');
			}
			else if( !result.permitted ){
				if(req.session.username)
					res.status(403).send('Asset does not allow unprivileged writes');
				else
					res.status(401).send('Asset does not allow anonymous writes');
			}
			else
			{
				var fields = {};
				fields[req.params.field] = req.body.toString();

				setMetadata(id, fields,
					function(err,result){
						if(err){
							console.error('Failed to set metadata:', err);
							res.status(500).send('DB error');
						}
						else {
							res.sendStatus(200);
						}
					}
				);
			}
		});
	}
}

function deleteAllMetadata(req,res,next)
{
	var id = parseInt(req.params.id, 16);
	perms.hasPerm(id, req.session.username, perms.WRITE, function(err,result)
	{
		if(err){
			console.error('Failed to check permissions:', err);
			res.status(500).send('DB error');
		}
		else if(!result){
			res.status(404).send('No asset with this ID');
		}
		else if( !result.permitted ){
			if(req.session.username)
				res.status(403).send('Asset does not allow unprivileged writes');
			else
				res.status(401).send('Asset does not allow anonymous writes');
		}
		else
		{
			db.queryNoResults('DELETE FROM Metadata WHERE id = $id', {$id: id}, function(err)
			{
				if(err){
					console.error('Failed to clear metadata:', err);
					res.status(500).send('DB error');
				}
				else {
					res.sendStatus(204);
				}
			});
		}	
	});
}

function deleteSomeMetadata(req,res,next)
{
	var id = parseInt(req.params.id, 16);
	if( ['permissions','group_name','type','user_name','created','last_modified','size'].indexOf(req.params.field) > -1 ){
		res.status(403).send('Cannot clear protected field');
	}
	else
	{
		perms.hasPerm(id, req.session.username, perms.WRITE, function(err,result)
		{
			if(err){
				console.error('Failed to check permissions:', err);
				res.status(500).send('DB error');
			}
			else if(!result){
				res.status(404).send('No asset with this ID');
			}
			else if( !result.permitted ){
				if(req.session.username)
					res.status(403).send('Asset does not allow unprivileged writes');
				else
					res.status(401).send('Asset does not allow anonymous writes');
			}
			else
			{
				db.queryNoResults('DELETE FROM Metadata WHERE id = $id AND key = $key', {$id: id, $key: req.params.field },
					function(err,result)
					{
						if(err){
							console.error('Failed to clear metadata:', err);
							res.status(500).send('DB error');
						}
						else if( result.changes === 0 ){
							res.status(404).send('No metadata for this asset with that name');
						}
						else {
							res.sendStatus(204);
						}
					}
				);
			}
		});
	}

}

exports.setMetadata = setMetadata;

exports.getAllMetadata = getAllMetadata;
exports.getSomeMetadata = getSomeMetadata;
exports.setAllMetadata = setAllMetadata;
exports.setSomeMetadata = setSomeMetadata;
exports.deleteAllMetadata = deleteAllMetadata;
exports.deleteSomeMetadata = deleteSomeMetadata;

