let url = require('url');
let hal = require('hal');
let express = require('express');
let pluralize = require('pluralize');
let debug = require('debug')('rest-service-builder');

function first(x) {
    return x && x.length > 0 ? x[0] : null;
}

function last(x) {
    return x && x.length > 0 ? x[x.length - 1] : null;
}

export function hal_formatter(req, res, next) {
    let status_code;
    let resource = null;
    if (res.fluent_rest.error) {
        let error = {
            message: res.fluent_rest.error.message,
            status_code: res.fluent_rest.error.status_code
        };
        resource = new hal.Resource(error, res.fluent_rest.uri);
        status_code = res.fluent_rest.error.status_code || 500;
    } else {
        if (res.fluent_rest.rows.length > 1) {
            resource = new hal.Resource({}, res.fluent_rest.uri); 
            resource.embed(res.fluent_rest.name, res.fluent_rest.rows);
        }
        else {
            resource = new hal.Resource(first(res.fluent_rest.rows), res.fluent_rest.uri);
        }
        status_code = res.fluent_rest.status_code || 200;
    }
    res.format({
        'application/hal+json': function() {
            res.fluent_rest.links.forEach((x) => resource.link(x.name, x.url));
            res.type('application/hal+json').status(status_code).send(resource.toJSON());
            next();
        },

        'application/hal+xml': function() {
            function escapeXml(unsafe) {
                return unsafe.replace(/[<>&'"]/g, function (c) {
                    switch (c) {
                        case '<': return '&lt;';
                        case '>': return '&gt;';
                        case '&': return '&amp;';
                        case '\'': return '&apos;';
                        case '"': return '&quot;';
                    }
                });
            }            
            res.fluent_rest.links.forEach((x) => {
                x.url.href = escapeXml(x.url.href);
                resource.link(x.name, x.url);
            });
            res.type('application/hal+xml').status(status_code).send(resource.toXML());
            next();
        },

        'default': function() {
            next();
        }
    });
}

export function links_header_formatter(req, res, next) {
    let links = {};
    for (let x in res.fluent_rest.links) {
        links[x.name] = x.url;
    }
    res.links(links);
    next();
};

class endpoint {
    constructor(router, links) {
        this._router = router;
        this._links = links || [];
    }

    get router() {
        return this._router;
    }

    get links() {
        return this._links;
    }
}

class entity_builder {
    constructor(db, entity, resource) {
        this._db = db;
        this._entity = entity;
        this._constraints = {};
        this._primary_key = 'id';
        this._resource = resource;
        this._full_text_entity = null;
        this._verbs = { get: true, put: true, patch: true, post: true, delete: true };
        this._reserved = { fields: true, sort: true, q: true, page: true, page_count: true };
    }

    get resource() {
        return this._resource;
    }

    disable_get() {
        this._verbs.get = false;
        return this;
    }

    disable_put() {
        this._verbs.put = false;
        return this;
    }

    disable_patch() {
        this._verbs.patch = false;
        return this;
    }

    disable_post() {
        this._verbs.post = false;
        return this;
    }

    disable_delete() {
        this._verbs.delete = false;
        return this;
    }

    primary_key(pk) {
        this._primary_key = pk;
        return this;
    }

    reserve(field) {
        this._reserved[field] = true;
        return this;
    }

    on_constraint_violation(name, error) {
        this._constraints[name] = error;
        return this;
    }

    uses_full_text_entity(name, field) {
        this._full_text_entity = { name, field: field || 'document' };
        return this;
    }

    entity(use, req) {
        if (typeof this._entity === 'function')
            return this._entity(use, req);
        return this._entity;
    }

    endpoint() {
        let links = [];
        let router = express.Router();
        let mp = this.resource.mount_point;
        let base_uri = mp.uri;
        if (!base_uri.endsWith('/'))
            base_uri += '/';
        let uri = url.resolve(base_uri, mp.resource_name);
        let singular = pluralize.singular(mp.resource_name);
        let id_name = `${singular}_id`;

        links.push({ name: mp.resource_name, url: { href: `${uri}/` }});
        links.push({ name: singular, url: { href: `${uri}/{id}/`, templated: true }});
        if (this._full_text_entity)
            links.push({ name: `${singular}_search`, url: { href: `${uri}/{?q}`, templated: true }});

        let is_allowed = (req, res) => {            
            if (this._verbs[req.method.toLowerCase()]) return true;

            let error = new Error(`This resource does not support the HTTP verb ${req.method.toUpperCase()}.`);
            error.status_code = 405;
            res.fluent_rest = { error }; 
            middleware_chainer(0, req, res);
            return false;
        };

        let middleware_chainer = (i, req, res) => {
            if (i >= mp.rest_service.middlewares.length) {
                res.end();
                return;
            }
            let mw = mp.rest_service.middlewares[i];
            mw(req, res, () => {
                middleware_chainer(i + 1, req, res);
            });
        };

        let select_fields = (fields) => fields ? fields.split(',').map((x) => x.trim()) : '*'; 
    
        let get_filters = (req) => {
            let list = {};
            for (let x in req.query) {
                if (this._reserved[x]) continue;
                list[x] = req.query[x];
            }
            return list;
        };

        let get_sorts = (req) => req.query.sort
            .split(',')
            .map((x) => x.charAt(0) === '-' ? x.substring(1) + ' desc' : x);

        let handler = (req, res) => {
            if (!is_allowed(req, res)) return;

            let id = req.params[id_name];

            if (id) {
                let named_query = this.resource.named_queries[id];
                if (named_query) {
                    for (let x in named_query)
                        req.query[x] = named_query[x];
                } else {
                    let fields = select_fields(req.query.fields);
                    this._db.select(fields)
                        .from(this.entity('get-id', req))
                        .where(this._primary_key, id)
                        .rows((err, rows) => {
                            if (!err && (!rows || rows.length === 0)) {
                                err = new Error(`No resource exists at ${uri}/${id}/.`);
                                err.status_code = 404;
                            }
                            res.fluent_rest = {
                                rows: rows ? rows : [],
                                error: err,
                                links: [],
                                name: mp.resource_name,
                                uri: `${uri}/${id}/`
                            };
                            middleware_chainer(0, req, res);
                        });
                    return;
                }
            }

            let fields = select_fields(req.query.fields);
            let count_query, query = null;

            if (this._full_text_entity && req.query.q) {
                count_query = this._db.select('count(*) as c')
                    .from(this._full_text_entity.name)
                    .where(this._full_text_entity.field, req.query.q);

                query = this._db.select(fields)
                    .from(this._full_text_entity.name)
                    .where(this._full_text_entity.field, req.query.q);
            } else {
                query = this._db.select(fields).from(this.entity('get', req));
                count_query = this._db.select('count(*) as c').from(this.entity('get', req));
            }

            if (req.query.sort) {
                query = query.orderBy(get_sorts(req));
            }

            let filters = get_filters(req);
            if (Object.keys(filters).length > 0) {
                query = query.where(filters);
                count_query = count_query.where(filters);
            }

            let page_count = parseInt(req.query.page_count || this.resource.page_count);
            if (req.query.page) {
                query = query.offset(req.query.page * page_count);
            }
            query = query.limit(page_count);

            let _uri = req.params.id ? `${uri}/${id}/` : `${uri}/`;

            if (!this.resource.pagination) {
                query.rows((err, rows) => {
                    res.fluent_rest = {
                        rows: rows ? rows : [],
                        error: err,
                        links: [],
                        name: mp.resource_name,
                        pagination: {},
                        uri: _uri 
                    };
                    middleware_chainer(0, req, res);
                });
            }
            else {
                count_query.rows((err, rows) => {
                    let page_links = [];
                    let page = parseInt(req.query.page || 0);
                    let r = first(rows);
                    let total_count = r ? r.c : 0;
                    let number_of_pages = Math.ceil(total_count / page_count);

                    if (page < number_of_pages - 1) {
                        page_links.push({ name: 'next', url: { href: `${_uri}?page=${page + 1}&page_count=${page_count}` }});
                    }

                    if (page > 0) {
                        page_links.push({ name: 'prev', url: { href: `${_uri}?page=${page - 1}&page_count=${page_count}` }});
                    }

                    for (let i = 0; i < number_of_pages; i++) {
                        page_links.push({ name: `pages`, url: { href: `${_uri}?page=${i}&page_count=${page_count}` }});
                    }

                    query.rows((err, rows) => {
                        res.fluent_rest = {
                            rows: rows ? rows : [],
                            error: err,
                            links: page_links,
                            name: mp.resource_name,
                            pagination: {
                                total_count,
                                number_of_pages,
                                page: req.query.page,
                                page_count: page_count
                            },
                            uri: _uri 
                        };
                        middleware_chainer(0, req, res);
                    });
                });
            }
        };

        router.get('/', handler);
        router.get(`/:${id_name}`, handler);

        router.put(`/:${id_name}`, (req, rest, next) => {
            if (!is_allowed(req, res)) return;

            let id = req.params[id_name];

            this._db.select()
                .from(this.entity('get-id', req))
                .where(this._primary_key, id)
                .rows((err, rows) => {
                    if (err) {
                        res.fluent_rest = { error: err };
                        middleware_chainer(0, req, res);
                        return;
                    }
                    let obj = first(rows);
                    if (!obj) {
                        let error = new Error(`No resource exists at ${uri}/${id}/.`);
                        error.status_code = 404;
                        res.fluent_rest = { error };
                        middleware_chainer(0, req, res);
                    } else {
                        this._db.update(this.entity('put', req), req.body)
                            .where(this._primary_key, id)
                            .returning(select_fields(req.query.fields))
                            .row((err, row) => {
                                if (err) err.status_code = 500;
                                res.fluent_rest = {
                                    rows: [row],
                                    error: err,
                                    links: [],
                                    name: mp.resource_name,
                                    uri: `${uri}/${id}/`
                                };
                                middleware_chainer(0, req, res);
                            });
                    }
                });
        });

        router.patch(`/:${id_name}`, (req, rest, next) => {
            if (!is_allowed(req, res)) return;

            let id = req.params[id_name];

            this._db.select()
                .from(this.entity('get-id', req))
                .where(this._primary_key, id)
                .rows((err, rows) => {
                    if (err) {
                        res.fluent_rest = { error: err };
                        middleware_chainer(0, req, res);
                        return;
                    }
                    let obj = first(rows);
                    if (!obj) {
                        let error = new Error(`No resource exists at ${uri}/${id}/.`);
                        error.status_code = 404;
                        res.fluent_rest = { error };
                        middleware_chainer(0, req, res);
                    } else {
                        let patches = req.body;
                        if (typeof patches === 'Array') {
                            jsonpatch.apply(obj, patches);
                        } else {
                            obj = patches;
                        }
                        this._db.update(this.entity('patch', req), obj)
                            .where(this._primary_key, id)
                            .returning(select_fields(req.query.fields))
                            .row((err, row) => {
                                if (err) err.status_code = 500;
                                res.fluent_rest = {
                                    rows: [row],
                                    error: err,
                                    links: [],
                                    name: mp.resource_name,
                                    uri: `${uri}/${id}/`
                                };
                                middleware_chainer(0, req, res);
                            });
                    }
                });
        });
    
        router.post('/', (req, res) => {
            if (!is_allowed(req, res)) return;

            this._db.insert(this.entity('post', req), req.body)
                .returning(select_fields(req.query.fields))
                .row((err, row) => {
                    if (err) err.status_code = 500;
                    res.fluent_rest = {
                        rows: [row],
                        error: err,
                        links: [],
                        uri: `${uri}/`,
                        status_code: 201,
                        name: mp.resource_name
                    };
                    middleware_chainer(0, req, res);
                });
        });

        router.delete('/', (req, res) => {
            if (!is_allowed(req, res)) return;

            let query = this._db.delete(this.entity('del', req));

            let filters = get_filters(req);
            if (Object.keys(filters).length > 0) {
                query = query.where(filters);
            }

            query.run((err) => {
                if (err) err.status_code = 500;
                res.fluent_rest = {
                    rows: [],
                    error: err,
                    links: [],
                    uri: `${uri}/`,
                    status_code: 204,
                    name: mp.resource_name
                };
                middleware_chainer(0, req, res);
            });
        });

        router.delete(`/:${id_name}`, (req, res) => {
            if (!is_allowed(req, res)) return;

            let id = req.params[id_name];

            this._db.delete(this.entity('del', req))
                .where(this._primary_key, id)
                .run((err) => {
                    if (err) err.status_code = 500;
                    res.fluent_rest = {
                        rows: [],
                        error: err,
                        links: [],
                        status_code: 204,
                        name: mp.resource_name,
                        uri: `${uri}/${id}/` 
                    };
                    middleware_chainer(0, req, res);
                });
        });

        mp.router.use(uri, router);

        return new endpoint(router, links);
    }
}

class verbs_builder {
    constructor(resource) {
        this._resource = resource;
        this._get = null;
        this._put = null;
        this._patch = null;
        this._post = null;
        this._del = null;
        this._links = [];
    }

    get resource() {
        return this._resource;
    }

    on_get(mw) {
        this._get = mw;
        return this;
    }

    on_put(mw) {
        this._put = mw;
        return this;
    }

    on_patch(mw) {
        this._patch = mw;
        return this;
    }

    on_post(mw) {
        this._post = mw;
        return this;
    }

    on_del(mw) {
        this._del = mw;
        return this;
    }

    links(links) {
        this._links = links;
        return this;
    }

    endpoint() {
        let router = express.Router();

        if (this._get) router.get(this._get);
        if (this._put) router.put(this._put);
        if (this._patch) router.patch(this._patch);
        if (this._post) router.post(this._post);
        if (this._del) router.del(this._del);

        let mp = this.resource.mount_point;
        mp.router.use(
            url.resolve(mp.uri, mp.resource_name),
            router);

        return new endpoint(routeri, this._links);
    }
}

class resource_builder {
    constructor(mount_point) {
        this._page_size = 100;
        this._description = null;
        this._named_queries = {};
        this._mount_point = mount_point;
        this._supports_pagination = true;
    }

    get pagination() {
        return this._supports_pagination;
    }

    get page_count() {
        return this._page_size;
    }

    get mount_point() {
        return this._mount_point;
    }

    get description() {
        return this._description;
    }

    get named_queries() {
        return this._named_queries;
    }

    page_size(size) {
        this._page_size = size;
        return this;
    }

    named_query(name, params) {
        this._named_queries[name] = params;
        return this;
    }

    description(description) {
        this._description = description;
        return this;
    }

    supports_pagination(flag) {
        this._supports_pagination = flag;
        return this;
    }

    for_endpoints(endpoints) {
        this._supports_pagination = false;
        // XXX: This is what creates something like the /api/v1/ root resource from a list
        //      of already created endpoints.
    }

    for_entity(conn_str, entity) {
        return new entity_builder(conn_str, entity, this);
    }

    for_verbs() {
        return new verbs_builder(this);
    }
}

class mount_point_builder {
    constructor(router, uri, rest_service) {
        this._uri = uri || '/';
        this._router = router;
        this._resource_name = null;
        this._rest_service = rest_service;
    }

    get uri() {
        return this._uri;
    }

    get router() {
        return this._router;
    }

    get rest_service() {
        return this._rest_service;
    }

    get resource_name() {
        return this._resource_name;
    }

    resource(name) {
        this._resource_name = name;
        return new resource_builder(this);
    }
}

export class rest_service_builder {
    constructor() {
        this._uri = null;
        this._middlewares = [];
        this._version_header = 'API-Version';
    }

    get middlewares() {
        return this._middlewares;
    }

    use(mw) {
        this._middlewares.push(mw);
        return this;
    }

    mount_at(router, uri) {
        return new mount_point_builder(router, uri, this);
    }

    version_header(name) {
        this._version_header = name;
        return this;
    }
}
