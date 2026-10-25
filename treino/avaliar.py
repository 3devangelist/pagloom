"""Mede quanto a proposta automática do Pagloom fica longe das malhas corrigidas à mão.

Lê todos os treino/dados/*.treino.zip (exportados pelo Pagloom ao lado do PDF) e compara,
página a página, a malha proposta com a final. Só usa a biblioteca padrão do Python.

    py treino/avaliar.py            resumo + piores casos
    py treino/avaliar.py -v         uma linha por foto
"""
import json
import math
import statistics
import sys
import zipfile
from pathlib import Path

DADOS = Path(__file__).parent / "dados"


def corners(m):
    n = m["N"]
    p = m["nodes"]
    return [p[0], p[n - 1], p[n * n - 1], p[n * (n - 1)]]


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def compare(prop, final, diag):
    """Erros em % da diagonal da foto: canto pior e média de todos os pontos (se as grelhas forem iguais)."""
    ce = max(dist(a, b) for a, b in zip(corners(prop), corners(final))) / diag * 100
    ne = None
    if prop["N"] == final["N"]:
        ne = statistics.mean(dist(a, b) for a, b in zip(prop["nodes"], final["nodes"])) / diag * 100
    return ce, ne


def main():
    verbose = "-v" in sys.argv
    zips = sorted(DADOS.glob("*.zip"))
    if not zips:
        print(f"Sem dados em {DADOS} — põe lá os .treino.zip exportados pelo Pagloom.")
        return
    rows, fotos, ignoradas, falta, a_mais = [], 0, 0, 0, 0
    for z in zips:
        with zipfile.ZipFile(z) as f:
            doc = json.loads(f.read("malhas.json"))
        for ph in doc["photos"]:
            fotos += 1
            if ph["skipped"]:
                ignoradas += 1
                continue
            diag = math.hypot(ph["W"], ph["H"])
            prop = (ph.get("proposed") or {}).get("meshes", [])
            fin = ph["final"]
            falta += max(0, len(fin) - len(prop))
            a_mais += max(0, len(prop) - len(fin))
            # cada malha proposta conta para a página final mais próxima (uma para uma, as melhores primeiro)
            pairs = sorted((compare(p, m, diag), a, k) for a, p in enumerate(prop) for k, m in enumerate(fin))
            used_p, used_f = set(), set()
            for (ce, ne), a, k in pairs:
                if a in used_p or k in used_f:
                    continue
                used_p.add(a)
                used_f.add(k)
                rows.append((ce, ne, z.name, ph["source"], k + 1))
                if verbose:
                    print(f"{z.name:30} {ph['source']:28} pág {k + 1}: canto {ce:5.1f}%  pontos {ne if ne is None else round(ne, 1)}%")
    paginas = len(rows) + falta
    print(f"{len(zips)} zip(s), {fotos} fotos ({ignoradas} ignoradas), {paginas} páginas corrigidas")
    print(f"páginas que a proposta não encontrou: {falta}   malhas propostas a mais: {a_mais}")
    if rows:
        ce = [r[0] for r in rows]
        ne = [r[1] for r in rows if r[1] is not None]
        for lim in (0.5, 1, 2, 5):
            print(f"  canto pior ≤ {lim}% da diagonal: {sum(c <= lim for c in ce)} de {paginas}")
        print(f"  mediana: canto pior {statistics.median(ce):.1f}%" + (f", média dos pontos {statistics.median(ne):.1f}%" if ne else ""))
        print("piores:")
        for ce_, ne_, z, src, k in sorted(rows, reverse=True)[:8]:
            print(f"  {ce_:5.1f}%  {src} pág {k}  ({z})")


if __name__ == "__main__":
    sys.stdout.reconfigure(errors="replace")
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
    # aberto com duplo clique, a janela fechava logo: fica à espera
    input("\nEnter para fechar…")
