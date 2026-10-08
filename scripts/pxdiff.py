"""Pixel diff of two PNGs (no dependencies). Usage: python3 scripts/pxdiff.py a.png b.png"""
import sys, zlib, struct
from collections import Counter
def load(p):
    d=open(p,'rb').read(); i=8; idat=b''
    while i<len(d):
        n=struct.unpack('>I',d[i:i+4])[0]; t=d[i+4:i+8]; c=d[i+8:i+8+n]
        if t==b'IHDR': w,h,_,ct=struct.unpack('>IIBB',c[:10])
        if t==b'IDAT': idat+=c
        i+=12+n
    raw=zlib.decompress(idat); bpp=4 if ct==6 else 3; st=w*bpp; rows=[]; prev=bytearray(st); o=0
    for _ in range(h):
        f=raw[o]; o+=1; L=bytearray(raw[o:o+st]); o+=st
        for x in range(st):
            a=L[x-bpp] if x>=bpp else 0; b=prev[x]; c=prev[x-bpp] if x>=bpp else 0
            if f==1: L[x]=(L[x]+a)&255
            elif f==2: L[x]=(L[x]+b)&255
            elif f==3: L[x]=(L[x]+(a+b)//2)&255
            elif f==4:
                p=a+b-c; pa,pb,pc=abs(p-a),abs(p-b),abs(p-c); L[x]=(L[x]+(a if pa<=pb and pa<=pc else b if pb<=pc else c))&255
        rows.append(bytes(L)); prev=L
    return w,h,bpp,rows
w,h,bpp,A=load(sys.argv[1]); w2,h2,_,B=load(sys.argv[2])
if (w,h)!=(w2,h2): print(f'size differs {w}x{h} vs {w2}x{h2}'); sys.exit(2)
diff=[(x,y,A[y][x*bpp:x*bpp+3],B[y][x*bpp:x*bpp+3]) for y in range(h) if A[y]!=B[y] for x in range(w) if A[y][x*bpp:x*bpp+3]!=B[y][x*bpp:x*bpp+3]]
print(f'{sys.argv[2]}: {len(diff)} px changed', end='')
if diff:
    xs=[d[0] for d in diff]; ys=[d[1] for d in diff]; print(f'  bbox {min(xs)},{min(ys)} → {max(xs)},{max(ys)}')
else: print()
