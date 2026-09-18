# Brand

`repertoire-lab-logo-1024.png` is the master artwork. Everything in
`public/icons/` is cut from it — the 180 and 512 there are byte-identical
crops of this file, and any new size should come from here too.

It lives outside `public/` on purpose: the app never loads it, so shipping it
would put a megabyte into the build and into every device's offline cache for
nothing.
