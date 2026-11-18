"""OpenMetadata REST collections the replica holds, and their entity types."""

from __future__ import annotations

import re

# REST collection (relative to /api/v1) -> entityType, in snapshot order (docs/team-backend.md, "Snapshot").
COLLECTIONS: dict[str, str] = {
    "services/databaseServices": "databaseService",
    "databases": "database",
    "databaseSchemas": "databaseSchema",
    "tables": "table",
    "queries": "query",
    "metrics": "metric",
    "users": "user",
    "teams": "team",
    "classifications": "classification",
    "tags": "tag",
    "glossaries": "glossary",
    "glossaryTerms": "glossaryTerm",
    "domains": "domain",
    "dataProducts": "dataProduct",
    "dataQuality/testDefinitions": "testDefinition",
    "dataQuality/testSuites": "testSuite",
    "dataQuality/testCases": "testCase",
    "services/ingestionPipelines": "ingestionPipeline",
}
TYPE_TO_COLLECTION: dict[str, str] = {t: c for c, t in COLLECTIONS.items()}

# Used when OpenMetadata rejects fields=* for a collection: the widest list we know it accepts.
FALLBACK_FIELDS: dict[str, str] = {
    "services/databaseServices": "pipelines,owners,tags,domains,followers",
    "databases": "owners,tags,domains,usageSummary,followers,votes,extension,dataProducts,databaseSchemas,location",
    "databaseSchemas": "owners,tags,domains,usageSummary,followers,votes,extension,dataProducts,tables",
    "tables": "columns,tableConstraints,tablePartition,usageSummary,owners,customMetrics,tags,followers,joins,"
    "schemaDefinition,dataModel,extension,testSuite,domains,dataProducts,lifeCycle,sourceHash,votes",
    "queries": "owners,followers,users,votes,tags,queryUsedIn",
    "metrics": "owners,followers,tags,domains,dataProducts,votes,extension,relatedMetrics",
    "users": "profile,roles,teams,follows,owns,domains,personas,defaultPersona",
    "teams": "owners,profile,users,owns,defaultRoles,parents,children,policies,userCount,childrenCount,domains",
    "classifications": "usageCount,termCount",
    "tags": "children,usageCount",
    "glossaries": "owners,tags,reviewers,usageCount,termCount,domains,extension,votes",
    "glossaryTerms": "children,relatedTerms,reviewers,owners,tags,usageCount,domains,extension,childrenCount,votes",
    "domains": "children,owners,parent,experts,tags,followers",
    "dataProducts": "domains,owners,experts,assets,extension,tags,followers",
    "dataQuality/testDefinitions": "owners",
    "dataQuality/testSuites": "owners,tests,summary,domains",
    "dataQuality/testCases": "owners,testSuite,testSuites,testDefinition,testCaseResult,incidentId,tags,domains",
    "services/ingestionPipelines": "owners,pipelineStatuses,followers,domains",
}

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def is_uuid(s: str) -> bool:
    return bool(UUID_RE.match(s))


def split_collection(path: str) -> tuple[str | None, list[str]]:
    """'/dataQuality/testCases/abc/x' -> ('dataQuality/testCases', ['abc', 'x']).

    Matches the longest known collection prefix; (None, segments) if none matches.
    """
    segs = [s for s in path.split("?")[0].split("/") if s]
    if len(segs) >= 2 and "/".join(segs[:2]) in COLLECTIONS:
        return "/".join(segs[:2]), segs[2:]
    if segs and segs[0] in COLLECTIONS:
        return segs[0], segs[1:]
    return None, segs


def collection_from_href(href: str) -> tuple[str, str] | None:
    """'http://om/api/v1/tables/<id>' -> ('tables', '<id>')."""
    _, _, rest = href.partition("/api/v1/")
    if not rest:
        return None
    coll, tail = split_collection("/" + rest)
    if coll and tail and is_uuid(tail[0]):
        return coll, tail[0]
    return None
