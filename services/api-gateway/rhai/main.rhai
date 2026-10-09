// Correlation ID: one x-request-id per client request, sent to every subgraph and back to
// the client. Subgraphs reuse it as their pino request id (services/auth/src/lib/request-context.ts),
// so the logs of every service involved in one query share the same id.

fn supergraph_service(service) {
    service.map_request(|request| {
        let id = if request.headers.contains("x-request-id") {
            request.headers["x-request-id"]
        } else {
            uuid_v4()
        };
        request.context["request_id"] = id;
    });

    service.map_response(|response| {
        // Only the primary response carries headers (later @defer chunks don't).
        if response.is_primary() {
            response.headers["x-request-id"] = response.context["request_id"];
        }
    });
}

fn subgraph_service(service, subgraph) {
    service.map_request(|request| {
        request.subgraph.headers["x-request-id"] = request.context["request_id"];
    });
}
