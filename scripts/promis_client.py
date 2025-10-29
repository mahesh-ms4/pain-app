"""Minimal client for the PROMIS Assessment Center API.

Usage examples:
  python scripts/promis_client.py list-forms
  python scripts/promis_client.py form-details D2FA612D-C290-4B88-957D-1C27F48EE58C
  python scripts/promis_client.py stateless D2FA612D-C290-4B88-957D-1C27F48EE58C --response PAININ9=Somewhat
Provide credentials via CLI flags or PROMIS_REGISTRATION/PROMIS_TOKEN env vars.
"""

import argparse
import json
import os
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlencode

import requests
from requests.auth import HTTPBasicAuth


DEFAULT_BASE_URL = "https://www.assessmentcenter.net/ac_api"
DEFAULT_API_VERSION = "2014-01"
DEFAULT_API_REGISTRATION = "86EBE839-C808-4CD9-B308-8EC79FAB2B76"
DEFAULT_API_TOKEN = "2460B692-2B83-463B-88B1-8F353D6698DD"


class PromisApiClient:
    """Thin wrapper around the PROMIS Assessment Center REST endpoints."""

    def __init__(
        self,
        registration: str = DEFAULT_API_REGISTRATION,
        token: str = DEFAULT_API_TOKEN,
        *,
        base_url: str = DEFAULT_BASE_URL,
        api_version: str = DEFAULT_API_VERSION,
        session: Optional[requests.Session] = None,
    ) -> None:
        if not registration or not token:
            raise ValueError("Both registration and token are required")

        self._base_url = base_url.rstrip("/")
        self._api_version = api_version.strip("/")
        self._auth = HTTPBasicAuth(registration, token)
        self._session = session or requests.Session()

    def _request(
        self,
        path: str,
        *,
        body: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        url = f"{self._base_url}/{self._api_version}/{path.lstrip('/')}"
        request_headers = {"Accept": "application/json"}
        if headers:
            request_headers.update(headers)

        response = self._session.post(
            url,
            data="" if body is None else body,
            headers=request_headers,
            params=params,
            auth=self._auth,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def list_forms(self) -> Dict[str, Any]:
        """Return metadata for available forms."""
        return self._request("Forms/.json")

    def form_details(self, form_oid: str) -> Dict[str, Any]:
        """Return question and response option data for the requested form."""
        if not form_oid:
            raise ValueError("form_oid must be provided")
        return self._request(f"Forms/{form_oid}.json")

    def stateless_next(
        self,
        form_oid: str,
        responses: Optional[Iterable[Dict[str, Any]]] = None,
        *,
        use_json_body: bool = True,
    ) -> Dict[str, Any]:
        if not form_oid:
            raise ValueError("form_oid must be provided")

        responses_list: List[Dict[str, Any]] = list(responses or [])
        has_responses = len(responses_list) > 0

        path = f"StatelessParticipants/{form_oid}.json"
        headers: Optional[Dict[str, str]] = None
        params: Optional[Dict[str, str]] = None
        body: Optional[str] = None

        if has_responses:
            if use_json_body:
                params = {"BodyParam": "true"}
                headers = {"Content-Type": "application/json"}
                body = json.dumps(responses_list)
            else:
                headers = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
                body = urlencode(
                    {resp["ItemID"]: resp["ItemResponseOID"] for resp in responses_list}
                )

        return self._request(
            f"{path}?BodyParam=true" if has_responses and use_json_body else path,
            body=body,
            headers=headers,
            params=None if has_responses and use_json_body else params,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CLI for the PROMIS Assessment Center API")
    parser.add_argument(
        "--registration",
        default=os.getenv("PROMIS_REGISTRATION"),
        help="Registration GUID (defaults to PROMIS_REGISTRATION env var)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("PROMIS_TOKEN"),
        help="Token GUID (defaults to PROMIS_TOKEN env var)",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"API base URL (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--api-version",
        default=DEFAULT_API_VERSION,
        help=f"API version segment (default: {DEFAULT_API_VERSION})",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list-forms", help="List available PROMIS forms")
    list_parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="Output format (default: json)",
    )

    details_parser = subparsers.add_parser("form-details", help="Get details for a specific form")
    details_parser.add_argument("form_oid", help="Form OID identifier")
    details_parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="Output format (default: json)",
    )

    stateless_parser = subparsers.add_parser(
        "stateless", help="Call the stateless assessment endpoint for a form"
    )
    stateless_parser.add_argument("form_oid", help="Form OID identifier")
    stateless_parser.add_argument(
        "--response",
        action="append",
        default=[],
        metavar="ITEM=CHOICE",
        help="Responses to submit (can be repeated). Example: --response PAININ9=Somewhat",
    )
    stateless_parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="Output format (default: json)",
    )

    return parser


def run_cli() -> None:
    parser = build_parser()
    args = parser.parse_args()

    registration = args.registration or DEFAULT_API_REGISTRATION
    token = args.token or DEFAULT_API_TOKEN

    client = PromisApiClient(
        registration=registration,
        token=token,
        base_url=args.base_url,
        api_version=args.api_version,
    )

    if args.command == "list-forms":
        data = client.list_forms()
        if args.format == "text":
            render_form_list_text(data)
        else:
            print_json(data)
    elif args.command == "form-details":
        data = client.form_details(args.form_oid)
        if args.format == "text":
            render_form_details_text(data)
        else:
            print_json(data)
    elif args.command == "stateless":
        try:
            responses = parse_response_args(args.response)
        except ValueError as exc:
            parser.error(str(exc))
            return
        data = client.stateless_next(args.form_oid, responses)
        if args.format == "text":
            render_stateless_text(data)
        else:
            print_json(data)
    else:
        parser.error(f"Unknown command: {args.command}")
        return


def print_json(data: Dict[str, Any]) -> None:
    import json

    print(json.dumps(data, indent=2, sort_keys=True))


def render_form_list_text(data: Dict[str, Any]) -> None:
    forms = data.get("Form", [])
    if not forms:
        print("No forms returned.")
        return

    for idx, form in enumerate(forms, start=1):
        name = form.get("Name") or form.get("Title") or "Untitled Form"
        oid = form.get("OID", "N/A")
        population = form.get("Population", "Unknown population")
        print(f"{idx}. {name} (OID: {oid}, Population: {population})")
        description = form.get("Description")
        if description:
            print(f"   Description: {description}")
        keywords = form.get("Keywords")
        if keywords:
            if isinstance(keywords, list):
                keywords_str = ", ".join(keywords)
            else:
                keywords_str = str(keywords)
            print(f"   Keywords: {keywords_str}")


def render_form_details_text(data: Dict[str, Any]) -> None:
    title = data.get("Name") or data.get("Title") or "Untitled Form"
    oid = data.get("OID", "Unknown OID")
    print(f"Form: {title}")
    print(f"OID: {oid}")
    population = data.get("Population")
    if population:
        print(f"Population: {population}")
    description = data.get("Description")
    if description:
        print(f"Description: {description}")

    items = data.get("Items") or []
    print(f"\nItems ({len(items)} total):")
    for idx, item in enumerate(items, start=1):
        item_id = item.get("ID", "Unknown ID")
        print(f"\n{idx}. Item ID: {item_id}")
        elements = item.get("Elements") or []
        for element in elements:
            description = element.get("Description")
            if description:
                print(f"   Prompt: {description}")
            maps = element.get("Map")
            if maps:
                print("   Options:")
                for option in maps:
                    value = option.get("Value")
                    label = option.get("Description", "")
                    print(f"     - ({value}) {label}")


def parse_response_args(pairs: Iterable[str]) -> List[Dict[str, Any]]:
    responses = []
    for index, raw in enumerate(pairs, start=1):
        if "=" not in raw:
            raise ValueError(f"Invalid response format '{raw}'. Expected ITEM=CHOICE.")
        item_id, choice = raw.split("=", 1)
        responses.append(
            {
                "ItemID": item_id.strip(),
                "ItemResponseOID": choice.strip(),
                "Order": index,
            }
        )
    return responses


def render_stateless_text(data: Dict[str, Any]) -> None:
    theta = data.get("Theta")
    std_error = data.get("StdError")
    t_score = data.get("tScore")
    numeric_t_score: Optional[float] = None

    if t_score is not None:
        try:
            numeric_t_score = float(t_score)
        except (TypeError, ValueError):
            numeric_t_score = None
    elif theta is not None:
        try:
            numeric_t_score = float(theta) * 10 + 50
        except (TypeError, ValueError):
            numeric_t_score = None

    if theta or std_error:
        print("Assessment metrics:")
        if theta:
            print(f"  Theta: {theta}")
        if std_error:
            print(f"  Standard Error: {std_error}")
        if numeric_t_score is not None:
            print(f"  T Score: {numeric_t_score:.1f}")
    else:
        print("Assessment metrics not yet available (assessment still running).")

    items = data.get("Items") or []
    if not items:
        print("\nNo items returned. Assessment may be complete.")
        return

    print(f"\nReturned Items ({len(items)}):")
    for idx, item in enumerate(items, start=1):
        item_id = item.get("ID", "Unknown ID")
        prompt = ""
        for element in item.get("Elements") or []:
            description = element.get("Description")
            if description:
                prompt = description
                break
        print(f"{idx}. {prompt or item_id} (Item ID: {item_id})")
        for element in item.get("Elements") or []:
            maps = element.get("Map")
            if maps:
                print("   Options:")
                for option in maps:
                    value = option.get("Value")
                    label = option.get("Description", "")
                    print(f"     - ({value}) {label}")


if __name__ == "__main__":
    run_cli()
